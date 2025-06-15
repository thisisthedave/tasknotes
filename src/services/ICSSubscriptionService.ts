import { Notice, requestUrl } from 'obsidian';
import * as ICAL from 'ical.js';
import { format, parseISO } from 'date-fns';
import { ICSSubscription, ICSEvent, ICSCache } from '../types';
import { EventEmitter } from '../utils/EventEmitter';
import TaskNotesPlugin from '../main';

export class ICSSubscriptionService extends EventEmitter {
    private plugin: TaskNotesPlugin;
    private subscriptions: ICSSubscription[] = [];
    private cache: Map<string, ICSCache> = new Map();
    private refreshTimers: Map<string, NodeJS.Timeout> = new Map();

    constructor(plugin: TaskNotesPlugin) {
        super();
        this.plugin = plugin;
    }

    async initialize(): Promise<void> {
        // Load subscriptions from plugin data
        await this.loadSubscriptions();
        
        // Start refresh timers for enabled subscriptions
        this.subscriptions.forEach(subscription => {
            if (subscription.enabled) {
                this.startRefreshTimer(subscription);
            }
        });

        // Emit initial data load
        this.emit('data-changed');
    }

    private async loadSubscriptions(): Promise<void> {
        try {
            const data = await this.plugin.loadData();
            this.subscriptions = data?.icsSubscriptions || [];
        } catch (error) {
            console.error('Failed to load ICS subscriptions:', error);
            this.subscriptions = [];
        }
    }

    private async saveSubscriptions(): Promise<void> {
        try {
            const data = await this.plugin.loadData() || {};
            data.icsSubscriptions = this.subscriptions;
            await this.plugin.saveData(data);
        } catch (error) {
            console.error('Failed to save ICS subscriptions:', error);
            throw error;
        }
    }

    getSubscriptions(): ICSSubscription[] {
        return [...this.subscriptions];
    }

    async addSubscription(subscription: Omit<ICSSubscription, 'id'>): Promise<ICSSubscription> {
        const newSubscription: ICSSubscription = {
            ...subscription,
            id: this.generateId()
        };

        this.subscriptions.push(newSubscription);
        await this.saveSubscriptions();

        if (newSubscription.enabled) {
            this.startRefreshTimer(newSubscription);
            // Immediately fetch the subscription
            await this.fetchSubscription(newSubscription.id);
        }

        this.emit('data-changed');
        return newSubscription;
    }

    async updateSubscription(id: string, updates: Partial<ICSSubscription>): Promise<void> {
        const index = this.subscriptions.findIndex(sub => sub.id === id);
        if (index === -1) {
            throw new Error('Subscription not found');
        }

        const oldSubscription = this.subscriptions[index];
        const updatedSubscription = { ...oldSubscription, ...updates };
        this.subscriptions[index] = updatedSubscription;

        await this.saveSubscriptions();

        // Update refresh timer
        this.stopRefreshTimer(id);
        if (updatedSubscription.enabled) {
            this.startRefreshTimer(updatedSubscription);
        }

        // Clear cache if URL changed
        if (updates.url && updates.url !== oldSubscription.url) {
            this.cache.delete(id);
        }

        this.emit('data-changed');
    }

    async removeSubscription(id: string): Promise<void> {
        const index = this.subscriptions.findIndex(sub => sub.id === id);
        if (index === -1) {
            throw new Error('Subscription not found');
        }

        this.subscriptions.splice(index, 1);
        await this.saveSubscriptions();

        // Clean up
        this.stopRefreshTimer(id);
        this.cache.delete(id);

        this.emit('data-changed');
    }

    async fetchSubscription(id: string): Promise<void> {
        const subscription = this.subscriptions.find(sub => sub.id === id);
        if (!subscription || !subscription.enabled) {
            return;
        }

        try {
            const response = await requestUrl({
                url: subscription.url,
                method: 'GET',
                headers: {
                    'Accept': 'text/calendar,application/calendar+xml,text/plain',
                    'User-Agent': 'TaskNotes-Plugin/1.0'
                }
            });

            const icsData = response.text;
            const events = this.parseICS(icsData, subscription.id);

            // Update cache
            const cache: ICSCache = {
                subscriptionId: id,
                events,
                lastUpdated: new Date().toISOString(),
                expires: new Date(Date.now() + subscription.refreshInterval * 60 * 1000).toISOString()
            };
            this.cache.set(id, cache);

            // Update subscription metadata
            await this.updateSubscription(id, {
                lastFetched: new Date().toISOString(),
                lastError: undefined
            });

            this.emit('data-changed');

        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            
            // Update subscription with error
            await this.updateSubscription(id, {
                lastError: errorMessage
            });

            // Show user notification for errors with more helpful message
            if (errorMessage.includes('404')) {
                new Notice(`Calendar "${subscription.name}" not found (404). Please check the ICS URL is correct and the calendar is publicly accessible.`);
            } else {
                new Notice(`Failed to fetch calendar "${subscription.name}": ${errorMessage}`);
            }
        }
    }


    private parseICS(icsData: string, subscriptionId: string): ICSEvent[] {
        try {
            const jcalData = ICAL.parse(icsData);
            const comp = new ICAL.Component(jcalData);
            const vevents = comp.getAllSubcomponents('vevent');

            const events: ICSEvent[] = [];

            vevents.forEach((vevent: ICAL.Component) => {
                try {
                    const event = new ICAL.Event(vevent);
                    
                    // Extract basic properties
                    const summary = event.summary || 'Untitled Event';
                    const description = event.description || undefined;
                    const location = event.location || undefined;
                    
                    // Handle start and end times
                    const startDate = event.startDate;
                    const endDate = event.endDate;
                    
                    if (!startDate) {
                        return; // Skip events without start date
                    }

                    const isAllDay = startDate.isDate;
                    const startISO = startDate.toJSDate().toISOString();
                    const endISO = endDate ? endDate.toJSDate().toISOString() : undefined;

                    // Generate unique ID
                    const uid = event.uid || `${subscriptionId}-${events.length}`;
                    const eventId = `${subscriptionId}-${uid}`;

                    const icsEvent: ICSEvent = {
                        id: eventId,
                        subscriptionId: subscriptionId,
                        title: summary,
                        description: description,
                        start: startISO,
                        end: endISO,
                        allDay: isAllDay,
                        location: location,
                        url: event.url || undefined
                    };

                    // Handle recurring events
                    if (event.isRecurring()) {
                        // For now, we'll generate instances for the next year
                        const iterator = event.iterator(startDate);
                        const maxDate = new ICAL.Time();
                        maxDate.fromJSDate(new Date(Date.now() + 365 * 24 * 60 * 60 * 1000)); // One year from now

                        let occurrence;
                        let instanceCount = 0;
                        const maxInstances = 100; // Prevent infinite loops

                        while ((occurrence = iterator.next()) && instanceCount < maxInstances) {
                            if (occurrence.compare(maxDate) > 0) {
                                break;
                            }

                            const instanceStart = occurrence.toJSDate().toISOString();
                            let instanceEnd = endISO;
                            
                            if (endDate && startDate) {
                                const duration = endDate.toJSDate().getTime() - startDate.toJSDate().getTime();
                                instanceEnd = new Date(occurrence.toJSDate().getTime() + duration).toISOString();
                            }

                            events.push({
                                ...icsEvent,
                                id: `${eventId}-${instanceCount}`,
                                start: instanceStart,
                                end: instanceEnd
                            });

                            instanceCount++;
                        }
                    } else {
                        events.push(icsEvent);
                    }

                } catch (eventError) {
                    console.warn('Failed to parse individual event:', eventError);
                }
            });

            return events;

        } catch (error) {
            console.error('Failed to parse ICS data:', error);
            throw new Error('Invalid ICS format');
        }
    }

    getAllEvents(): ICSEvent[] {
        const allEvents: ICSEvent[] = [];
        
        this.cache.forEach(cache => {
            // Check if cache is still valid
            if (new Date(cache.expires) > new Date()) {
                allEvents.push(...cache.events);
            }
        });

        return allEvents;
    }

    getEventsForSubscription(subscriptionId: string): ICSEvent[] {
        const cache = this.cache.get(subscriptionId);
        if (!cache || new Date(cache.expires) <= new Date()) {
            return [];
        }
        return [...cache.events];
    }

    async refreshAllSubscriptions(): Promise<void> {
        const enabledSubscriptions = this.subscriptions.filter(sub => sub.enabled);
        
        for (const subscription of enabledSubscriptions) {
            await this.fetchSubscription(subscription.id);
        }
    }

    async refreshSubscription(id: string): Promise<void> {
        await this.fetchSubscription(id);
    }

    private startRefreshTimer(subscription: ICSSubscription): void {
        this.stopRefreshTimer(subscription.id);
        
        const intervalMs = subscription.refreshInterval * 60 * 1000; // Convert minutes to milliseconds
        const timer = setInterval(() => {
            this.fetchSubscription(subscription.id);
        }, intervalMs);
        
        this.refreshTimers.set(subscription.id, timer);
    }

    private stopRefreshTimer(id: string): void {
        const timer = this.refreshTimers.get(id);
        if (timer) {
            clearInterval(timer);
            this.refreshTimers.delete(id);
        }
    }

    private generateId(): string {
        return 'ics_' + Math.random().toString(36).substr(2, 9) + Date.now().toString(36);
    }

    destroy(): void {
        // Clear all timers
        this.refreshTimers.forEach(timer => clearInterval(timer));
        this.refreshTimers.clear();
        
        // Clear cache
        this.cache.clear();
        
        // Clear event listeners
        this.removeAllListeners();
    }
}