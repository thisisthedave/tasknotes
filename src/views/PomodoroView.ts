import { ItemView, WorkspaceLeaf } from 'obsidian';
import TaskNotesPlugin from '../main';
import { 
    POMODORO_VIEW_TYPE,
    EVENT_POMODORO_START,
    EVENT_POMODORO_COMPLETE,
    EVENT_POMODORO_INTERRUPT,
    EVENT_POMODORO_TICK,
    PomodoroSession,
    TaskInfo
} from '../types';

export class PomodoroView extends ItemView {
    plugin: TaskNotesPlugin;
    
    // UI elements
    private timerDisplay: HTMLElement | null = null;
    private statusDisplay: HTMLElement | null = null;
    private startButton: HTMLButtonElement | null = null;
    private pauseButton: HTMLButtonElement | null = null;
    private stopButton: HTMLButtonElement | null = null;
    private taskDisplay: HTMLElement | null = null;
    private statsDisplay: HTMLElement | null = null;
    private taskSelectElement: HTMLSelectElement | null = null;
    
    // Cache stat elements to avoid innerHTML
    private statElements: {
        pomodoros: HTMLElement | null;
        streak: HTMLElement | null; 
        minutes: HTMLElement | null;
    } = { pomodoros: null, streak: null, minutes: null };
    
    // Event listeners
    private listeners: (() => void)[] = [];
    
    constructor(leaf: WorkspaceLeaf, plugin: TaskNotesPlugin) {
        super(leaf);
        this.plugin = plugin;
        
        // Register event listeners
        this.registerEvents();
    }
    
    getViewType(): string {
        return POMODORO_VIEW_TYPE;
    }
    
    getDisplayText(): string {
        return 'Pomodoro';
    }
    
    getIcon(): string {
        return 'clock';
    }
    
    registerEvents(): void {
        // Clean up any existing listeners
        this.listeners.forEach(unsubscribe => unsubscribe());
        this.listeners = [];
        
        // Listen for pomodoro events
        const startListener = this.plugin.emitter.on(EVENT_POMODORO_START, ({ session, task }) => {
            this.updateDisplay(session, task);
        });
        this.listeners.push(startListener);
        
        const completeListener = this.plugin.emitter.on(EVENT_POMODORO_COMPLETE, ({ session, nextType }) => {
            this.onPomodoroComplete(session, nextType);
        });
        this.listeners.push(completeListener);
        
        const interruptListener = this.plugin.emitter.on(EVENT_POMODORO_INTERRUPT, ({ session }) => {
            this.updateDisplay();
        });
        this.listeners.push(interruptListener);
        
        const tickListener = this.plugin.emitter.on(EVENT_POMODORO_TICK, ({ timeRemaining, session }) => {
            this.updateTimer(timeRemaining);
            this.updateDisplay(session);
        });
        this.listeners.push(tickListener);
    }
    
    async onOpen() {
        await this.render();
    }
    
    async onClose() {
        // Remove event listeners
        this.listeners.forEach(unsubscribe => unsubscribe());
        
        // Clear cached references
        this.taskSelectElement = null;
        this.statElements = { pomodoros: null, streak: null, minutes: null };
        
        this.contentEl.empty();
    }
    
    async render() {
        const container = this.contentEl.createDiv({ cls: 'tasknotes-container pomodoro-view-container' });
        
        // Header
        const header = container.createDiv({ cls: 'pomodoro-header' });
        header.createEl('h2', { text: 'Pomodoro timer' });
        
        // Timer display
        const timerSection = container.createDiv({ cls: 'pomodoro-timer-section' });
        this.timerDisplay = timerSection.createDiv({ cls: 'pomodoro-timer-display', text: '25:00' });
        this.statusDisplay = timerSection.createDiv({ cls: 'pomodoro-status', text: 'Ready to start' });
        
        // Task display
        this.taskDisplay = container.createDiv({ cls: 'pomodoro-task-display' });
        
        // Task selector
        const taskSelectorSection = container.createDiv({ cls: 'pomodoro-task-selector' });
        taskSelectorSection.createEl('label', { text: 'Select task (optional):' });
        
        this.taskSelectElement = taskSelectorSection.createEl('select', { cls: 'pomodoro-task-select' });
        this.taskSelectElement.createEl('option', { value: '', text: 'No task selected' });
        
        // Load tasks into dropdown
        this.populateTaskDropdown(this.taskSelectElement);
        
        // Add change handler for task selector
        this.taskSelectElement.addEventListener('change', async () => {
            const state = this.plugin.pomodoroService.getState();
            if (state.currentSession && state.currentSession.type === 'work') {
                // Allow changing task assignment during work sessions
                const selectedTaskPath = this.taskSelectElement!.value;
                let selectedTask = undefined;
                
                if (selectedTaskPath) {
                    try {
                        const tasks = await this.plugin.fileIndexer.getTaskInfoForDate(new Date());
                        selectedTask = tasks.find(task => task.path === selectedTaskPath);
                    } catch (error) {
                        console.error('Error getting selected task:', error);
                    }
                }
                
                await this.plugin.pomodoroService.assignTaskToCurrentSession(selectedTask);
            }
        });
        
        // Control buttons
        const controls = container.createDiv({ cls: 'pomodoro-controls' });
        
        this.startButton = controls.createEl('button', { 
            text: 'Start', 
            cls: 'pomodoro-button pomodoro-start-button'
        });
        
        this.pauseButton = controls.createEl('button', { 
            text: 'Pause', 
            cls: 'pomodoro-button pomodoro-pause-button'
        });
        this.pauseButton.addClass('is-hidden');
        
        this.stopButton = controls.createEl('button', { 
            text: 'Stop', 
            cls: 'pomodoro-button pomodoro-stop-button'
        });
        this.stopButton.addClass('is-hidden');
        
        // Quick actions
        const quickActions = container.createDiv({ cls: 'pomodoro-quick-actions' });
        
        const workButton = quickActions.createEl('button', {
            text: 'Start work',
            cls: 'pomodoro-quick-button'
        });
        
        const shortBreakButton = quickActions.createEl('button', {
            text: 'Short break',
            cls: 'pomodoro-quick-button'
        });
        
        const longBreakButton = quickActions.createEl('button', {
            text: 'Long break',
            cls: 'pomodoro-quick-button'
        });
        
        // Statistics
        const statsSection = container.createDiv({ cls: 'pomodoro-stats-section' });
        statsSection.createEl('h3', { text: 'Today\'s progress' });
        this.statsDisplay = statsSection.createDiv({ cls: 'pomodoro-stats' });
        
        // Create stat elements and cache references
        const pomodoroStat = this.statsDisplay.createDiv({ cls: 'pomodoro-stat' });
        this.statElements.pomodoros = pomodoroStat.createSpan({ cls: 'pomodoro-stat-value', text: '0' });
        pomodoroStat.createSpan({ cls: 'pomodoro-stat-label', text: 'Pomodoros completed' });
        
        const streakStat = this.statsDisplay.createDiv({ cls: 'pomodoro-stat' });
        this.statElements.streak = streakStat.createSpan({ cls: 'pomodoro-stat-value', text: '0' });
        streakStat.createSpan({ cls: 'pomodoro-stat-label', text: 'Current streak' });
        
        const minutesStat = this.statsDisplay.createDiv({ cls: 'pomodoro-stat' });
        this.statElements.minutes = minutesStat.createSpan({ cls: 'pomodoro-stat-value', text: '0' });
        minutesStat.createSpan({ cls: 'pomodoro-stat-label', text: 'Minutes focused' });
        
        // Add event listeners
        this.startButton.addEventListener('click', async () => {
            const state = this.plugin.pomodoroService.getState();
            if (state.currentSession && !state.isRunning) {
                this.plugin.pomodoroService.resumePomodoro();
            } else {
                // Get selected task if any
                const selectedTaskPath = this.taskSelectElement!.value;
                let selectedTask = undefined;
                
                if (selectedTaskPath) {
                    try {
                        // Get task info from the file indexer
                        const tasks = await this.plugin.fileIndexer.getTaskInfoForDate(new Date());
                        selectedTask = tasks.find(task => task.path === selectedTaskPath);
                    } catch (error) {
                        console.error('Error getting selected task:', error);
                    }
                }
                
                this.plugin.pomodoroService.startPomodoro(selectedTask);
            }
        });
        
        this.pauseButton.addEventListener('click', () => {
            this.plugin.pomodoroService.pausePomodoro();
        });
        
        this.stopButton.addEventListener('click', () => {
            this.plugin.pomodoroService.stopPomodoro();
        });
        
        workButton.addEventListener('click', async () => {
            // Get selected task if any
            const selectedTaskPath = this.taskSelectElement!.value;
            let selectedTask = undefined;
            
            if (selectedTaskPath) {
                try {
                    const tasks = await this.plugin.fileIndexer.getTaskInfoForDate(new Date());
                    selectedTask = tasks.find(task => task.path === selectedTaskPath);
                } catch (error) {
                    console.error('Error getting selected task:', error);
                }
            }
            
            this.plugin.pomodoroService.startPomodoro(selectedTask);
        });
        
        shortBreakButton.addEventListener('click', () => {
            this.plugin.pomodoroService.startBreak(false);
        });
        
        longBreakButton.addEventListener('click', () => {
            this.plugin.pomodoroService.startBreak(true);
        });
        
        // Initial display update
        this.updateDisplay();
        this.updateStats();
    }
    
    private async populateTaskDropdown(taskSelect: HTMLSelectElement) {
        try {
            // Get tasks for today and the next few days
            const today = new Date();
            const tasks: TaskInfo[] = [];
            
            // Get tasks from today and next 7 days
            for (let i = 0; i < 7; i++) {
                const date = new Date(today);
                date.setDate(today.getDate() + i);
                
                try {
                    const dayTasks = await this.plugin.fileIndexer.getTaskInfoForDate(date);
                    tasks.push(...dayTasks);
                } catch (error) {
                    // Error getting tasks for date
                }
            }
            
            // Remove duplicates and filter out completed/archived tasks
            const uniqueTasks = tasks
                .filter((task, index, arr) => 
                    arr.findIndex(t => t.path === task.path) === index &&
                    task.status !== 'done' && 
                    !task.archived
                )
                .sort((a, b) => {
                    // Sort by due date first, then by title
                    if (a.due && b.due) {
                        return a.due.localeCompare(b.due);
                    }
                    if (a.due && !b.due) return -1;
                    if (!a.due && b.due) return 1;
                    return a.title.localeCompare(b.title);
                });
            
            // Add tasks to dropdown
            uniqueTasks.forEach(task => {
                const option = taskSelect.createEl('option', {
                    value: task.path,
                    text: task.title + (task.due ? ` (due ${task.due})` : '')
                });
            });
            
        } catch (error) {
            console.error('Error populating task dropdown:', error);
        }
    }
    
    private updateDisplay(session?: PomodoroSession, task?: TaskInfo) {
        const state = this.plugin.pomodoroService.getState();
        
        // Update timer
        this.updateTimer(state.timeRemaining);
        
        // Update status
        if (this.statusDisplay) {
            if (state.isRunning && state.currentSession) {
                const typeText = state.currentSession.type === 'work' ? 'Working' : 
                               state.currentSession.type === 'short-break' ? 'Short break' : 'Long break';
                this.statusDisplay.textContent = typeText;
                this.statusDisplay.className = `pomodoro-status pomodoro-status-${state.currentSession.type}`;
            } else {
                this.statusDisplay.textContent = 'Ready to start';
                this.statusDisplay.className = 'pomodoro-status';
            }
        }
        
        // Update task display only if task info changed
        if (this.taskDisplay) {
            const currentTaskPath = state.currentSession?.taskPath;
            const currentDisplayPath = this.taskDisplay.dataset.currentTaskPath;
            
            if (currentTaskPath !== currentDisplayPath) {
                this.taskDisplay.empty();
                this.taskDisplay.dataset.currentTaskPath = currentTaskPath || '';
                
                if (session?.taskPath && task) {
                    const taskDiv = this.taskDisplay.createDiv({ cls: 'pomodoro-current-task' });
                    taskDiv.createSpan({ cls: 'pomodoro-task-label', text: 'Working on:' });
                    taskDiv.createSpan({ cls: 'pomodoro-task-title', text: task.title });
                } else if (state.currentSession?.taskPath) {
                    // Try to get task info from cache
                    const taskPath = state.currentSession.taskPath;
                    const taskDiv = this.taskDisplay.createDiv({ cls: 'pomodoro-current-task' });
                    taskDiv.createSpan({ cls: 'pomodoro-task-label', text: 'Working on:' });
                    taskDiv.createSpan({ cls: 'pomodoro-task-title', text: taskPath.split('/').pop()?.replace('.md', '') || '' });
                }
            }
        }
        
        // Update task selector dropdown to reflect current session
        if (this.taskSelectElement && state.currentSession) {
            this.taskSelectElement.value = state.currentSession.taskPath || '';
        }
        
        // Update button visibility
        if (this.startButton && this.pauseButton && this.stopButton) {
            if (state.isRunning) {
                this.startButton.addClass('is-hidden');
                this.pauseButton.removeClass('is-hidden');
                this.stopButton.removeClass('is-hidden');
            } else if (state.currentSession) {
                // Paused
                this.startButton.removeClass('is-hidden');
                this.startButton.textContent = 'Resume';
                this.pauseButton.addClass('is-hidden');
                this.stopButton.removeClass('is-hidden');
            } else {
                // Idle
                this.startButton.removeClass('is-hidden');
                this.startButton.textContent = 'Start';
                this.pauseButton.addClass('is-hidden');
                this.stopButton.addClass('is-hidden');
            }
        }
        
        this.updateStats();
    }
    
    private updateTimer(seconds: number) {
        if (this.timerDisplay) {
            const minutes = Math.floor(seconds / 60);
            const secs = seconds % 60;
            this.timerDisplay.textContent = `${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
        }
    }
    
    private updateStats() {
        const state = this.plugin.pomodoroService.getState();
        const totalMinutes = this.plugin.pomodoroService.getTotalMinutesToday();
        
        // Update only if values changed to avoid unnecessary DOM updates
        if (this.statElements.pomodoros && this.statElements.pomodoros.textContent !== state.pomodorosCompleted.toString()) {
            this.statElements.pomodoros.textContent = state.pomodorosCompleted.toString();
        }
        
        if (this.statElements.streak && this.statElements.streak.textContent !== state.currentStreak.toString()) {
            this.statElements.streak.textContent = state.currentStreak.toString();
        }
        
        if (this.statElements.minutes && this.statElements.minutes.textContent !== totalMinutes.toString()) {
            this.statElements.minutes.textContent = totalMinutes.toString();
        }
    }
    
    private onPomodoroComplete(session: PomodoroSession, nextType: string) {
        this.updateDisplay();
        
        // Show completion message
        if (this.statusDisplay) {
            if (session.type === 'work') {
                const isLongBreak = nextType === 'long-break';
                this.statusDisplay.textContent = `Great work! Time for a ${isLongBreak ? 'long' : 'short'} break`;
            } else {
                this.statusDisplay.textContent = 'Break complete! Ready for the next pomodoro?';
            }
        }
    }
}