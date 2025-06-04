import { Notice, TFile } from 'obsidian';
import { format } from 'date-fns';
import TaskNotesPlugin from '../main';
import { 
    PomodoroSession, 
    PomodoroState, 
    EVENT_POMODORO_START, 
    EVENT_POMODORO_COMPLETE, 
    EVENT_POMODORO_INTERRUPT, 
    EVENT_POMODORO_TICK,
    TaskInfo,
    TimeEntry
} from '../types';
import { ensureFolderExists } from '../utils/helpers';

export class PomodoroService {
    private plugin: TaskNotesPlugin;
    private timerInterval: NodeJS.Timeout | null = null;
    private state: PomodoroState;
    private stateFile = 'pomodoro-state.json';

    constructor(plugin: TaskNotesPlugin) {
        this.plugin = plugin;
        this.state = {
            isRunning: false,
            timeRemaining: plugin.settings.pomodoroWorkDuration * 60, // Default work duration in seconds
            pomodorosCompleted: 0,
            currentStreak: 0,
            totalMinutesToday: 0
        };
    }

    async initialize() {
        await this.loadState();
        
        // Resume timer if it was running
        if (this.state.isRunning && this.state.currentSession) {
            this.resumeTimer();
        }
        
        // Listen for visibility changes to handle app suspension/resume
        this.plugin.registerDomEvent(document, 'visibilitychange', () => {
            if (!document.hidden && this.state.isRunning && this.state.currentSession) {
                // App became visible again, check if timer needs adjustment
                this.resumeTimer();
            }
        });
    }

    async loadState() {
        try {
            const data = await this.plugin.loadData();
            if (data?.pomodoroState) {
                this.state = data.pomodoroState;
                
                // Validate loaded state
                this.state.pomodorosCompleted = Math.max(0, this.state.pomodorosCompleted || 0);
                this.state.currentStreak = Math.max(0, this.state.currentStreak || 0);
                this.state.totalMinutesToday = Math.max(0, this.state.totalMinutesToday || 0);
                this.state.timeRemaining = Math.max(0, this.state.timeRemaining || 0);
                
                // Reset daily counter if it's a new day
                const today = format(new Date(), 'yyyy-MM-dd');
                const lastDate = data.lastPomodoroDate;
                if (lastDate !== today) {
                    this.state.pomodorosCompleted = 0;
                    this.state.currentStreak = 0;
                    this.state.totalMinutesToday = 0;
                    // Clear any stale session from previous day
                    if (this.state.currentSession) {
                        this.state.currentSession = undefined;
                        this.state.isRunning = false;
                    }
                }
                
                // Validate current session
                if (this.state.currentSession) {
                    // Check if session is stale (older than 24 hours)
                    const sessionStart = new Date(this.state.currentSession.startTime).getTime();
                    const now = Date.now();
                    const hoursSinceStart = (now - sessionStart) / (1000 * 60 * 60);
                    
                    if (hoursSinceStart > 24) {
                        // Session is too old, clear it
                        this.state.currentSession = undefined;
                        this.state.isRunning = false;
                        this.state.timeRemaining = this.plugin.settings.pomodoroWorkDuration * 60;
                    }
                }
                
                // If no active session, reset timer to default duration
                if (!this.state.currentSession) {
                    this.state.timeRemaining = this.plugin.settings.pomodoroWorkDuration * 60;
                }
            }
        } catch (error) {
            console.error('Failed to load pomodoro state:', error);
            // Reset to clean state on error
            this.state = {
                isRunning: false,
                timeRemaining: this.plugin.settings.pomodoroWorkDuration * 60,
                pomodorosCompleted: 0,
                currentStreak: 0,
                totalMinutesToday: 0
            };
        }
    }

    async saveState() {
        try {
            const data = await this.plugin.loadData() || {};
            data.pomodoroState = this.state;
            data.lastPomodoroDate = format(new Date(), 'yyyy-MM-dd');
            await this.plugin.saveData(data);
        } catch (error) {
            console.error('Failed to save pomodoro state:', error);
        }
    }

    async saveLastSelectedTask(taskPath: string | undefined) {
        try {
            const data = await this.plugin.loadData() || {};
            data.lastSelectedTaskPath = taskPath;
            await this.plugin.saveData(data);
        } catch (error) {
            console.error('Failed to save last selected task:', error);
        }
    }

    async getLastSelectedTaskPath(): Promise<string | undefined> {
        try {
            const data = await this.plugin.loadData();
            return data?.lastSelectedTaskPath;
        } catch (error) {
            console.error('Failed to load last selected task:', error);
            return undefined;
        }
    }

    async startPomodoro(task?: TaskInfo) {
        if (this.state.isRunning) {
            new Notice('A pomodoro is already running');
            return;
        }
        
        // Check if there's a paused session that should be resumed instead
        if (this.state.currentSession && !this.state.isRunning) {
            new Notice('Resume the current session instead of starting a new one');
            return;
        }
        
        // Validate duration settings
        const duration = Math.max(1, Math.min(120, this.plugin.settings.pomodoroWorkDuration));

        const session: PomodoroSession = {
            id: Date.now().toString(),
            taskPath: task?.path,
            startTime: new Date().toISOString(),
            duration: duration,
            type: 'work',
            completed: false
        };

        this.state.currentSession = session;
        this.state.isRunning = true;
        this.state.timeRemaining = session.duration * 60; // Convert to seconds

        await this.saveState();
        this.startTimer();
        
        this.plugin.emitter.emit(EVENT_POMODORO_START, { session, task });
        new Notice(`Pomodoro started${task ? ` for: ${task.title}` : ''}`);
    }

    async startBreak(isLongBreak: boolean = false) {
        if (this.state.isRunning) {
            new Notice('A timer is already running');
            return;
        }
        
        // Check if there's a paused session
        if (this.state.currentSession && !this.state.isRunning) {
            new Notice('Resume the current session instead of starting a new one');
            return;
        }

        // Validate duration settings
        const duration = isLongBreak 
            ? Math.max(1, Math.min(60, this.plugin.settings.pomodoroLongBreakDuration))
            : Math.max(1, Math.min(30, this.plugin.settings.pomodoroShortBreakDuration));

        const session: PomodoroSession = {
            id: Date.now().toString(),
            startTime: new Date().toISOString(),
            duration: duration,
            type: isLongBreak ? 'long-break' : 'short-break',
            completed: false
        };

        this.state.currentSession = session;
        this.state.isRunning = true;
        this.state.timeRemaining = session.duration * 60;

        await this.saveState();
        this.startTimer();
        
        new Notice(`${isLongBreak ? 'Long' : 'Short'} break started`);
    }

    async pausePomodoro() {
        if (!this.state.isRunning || !this.timerInterval) {
            return;
        }

        this.stopTimer();
        this.state.isRunning = false;
        await this.saveState();
        
        // Emit event to update UI
        this.plugin.emitter.emit(EVENT_POMODORO_TICK, { 
            timeRemaining: this.state.timeRemaining,
            session: this.state.currentSession 
        });
        
        new Notice('Pomodoro paused');
    }

    async resumePomodoro() {
        if (this.state.isRunning || !this.state.currentSession) {
            return;
        }

        this.state.isRunning = true;
        await this.saveState();
        this.startTimer();
        
        // Emit event to update UI
        this.plugin.emitter.emit(EVENT_POMODORO_TICK, { 
            timeRemaining: this.state.timeRemaining,
            session: this.state.currentSession 
        });
        
        new Notice('Pomodoro resumed');
    }

    async stopPomodoro() {
        if (!this.state.currentSession) {
            return;
        }

        const wasRunning = this.state.isRunning;
        this.stopTimer();

        if (this.state.currentSession) {
            this.state.currentSession.interrupted = true;
            this.state.currentSession.endTime = new Date().toISOString();
        }

        this.plugin.emitter.emit(EVENT_POMODORO_INTERRUPT, { session: this.state.currentSession });

        this.state.currentSession = undefined;
        this.state.isRunning = false;
        this.state.timeRemaining = this.plugin.settings.pomodoroWorkDuration * 60; // Reset to default work duration
        
        await this.saveState();
        
        // Emit tick event to update UI with reset timer
        this.plugin.emitter.emit(EVENT_POMODORO_TICK, { 
            timeRemaining: this.state.timeRemaining,
            session: this.state.currentSession 
        });
        
        if (wasRunning) {
            new Notice('Pomodoro stopped and reset');
        }
    }

    private startTimer() {
        this.stopTimer(); // Clear any existing timer
        
        // Save state immediately when timer starts
        this.saveState().catch(error => {
            console.error('Failed to save state when starting timer:', error);
        });
        
        this.timerInterval = setInterval(async () => {
            if (this.state.timeRemaining > 0) {
                this.state.timeRemaining--;
                
                // Emit tick event for UI updates
                this.plugin.emitter.emit(EVENT_POMODORO_TICK, { 
                    timeRemaining: this.state.timeRemaining,
                    session: this.state.currentSession 
                });
                
                // Save state periodically (every 10 seconds) to persist progress
                if (this.state.timeRemaining % 10 === 0) {
                    this.saveState().catch(error => {
                        console.error('Failed to save periodic state:', error);
                    });
                }
            }

            if (this.state.timeRemaining <= 0) {
                await this.completePomodoro();
            }
        }, 1000); // Update every second
    }

    private stopTimer() {
        if (this.timerInterval) {
            clearInterval(this.timerInterval);
            this.timerInterval = null;
        }
    }

    private resumeTimer() {
        // Calculate time elapsed since last save
        if (this.state.currentSession && this.state.currentSession.startTime) {
            const startTime = new Date(this.state.currentSession.startTime).getTime();
            const now = Date.now();
            
            // Check for invalid start time (future dates)
            if (startTime > now) {
                // Reset session if start time is in the future
                this.stopPomodoro();
                return;
            }
            
            const elapsed = Math.floor((now - startTime) / 1000);
            const totalDuration = this.state.currentSession.duration * 60;
            
            // Account for paused time by using actual time remaining from state
            // rather than calculating from start time when session was paused
            if (!this.state.isRunning && this.state.timeRemaining > 0) {
                // Session was paused, use stored time remaining
                this.state.timeRemaining = Math.min(this.state.timeRemaining, totalDuration);
            } else {
                // Session was running, calculate based on elapsed time
                this.state.timeRemaining = Math.max(0, totalDuration - elapsed);
            }
            
            if (this.state.timeRemaining > 0 && this.state.isRunning) {
                this.startTimer();
            } else if (this.state.timeRemaining <= 0) {
                // Timer would have completed while app was closed
                this.completePomodoro();
            }
        }
    }

    private async completePomodoro() {
        this.stopTimer();
        
        if (!this.state.currentSession) {
            return;
        }

        const session = this.state.currentSession;
        session.completed = true;
        session.endTime = new Date().toISOString();

        // Update counters for work sessions
        if (session.type === 'work') {
            this.state.pomodorosCompleted++;
            this.state.currentStreak++;
            this.state.totalMinutesToday += session.duration; // Add actual duration
            
            // Track time on task if applicable
            if (session.taskPath) {
                await this.trackTimeOnTask(session);
            }

            // Update daily note with pomodoro count
            await this.updateDailyNotePomodoros();
        }

        // Determine next session
        const shouldTakeLongBreak = session.type === 'work' && 
            this.state.currentStreak % this.plugin.settings.pomodoroLongBreakInterval === 0;

        // Emit completion event
        this.plugin.emitter.emit(EVENT_POMODORO_COMPLETE, { 
            session, 
            nextType: session.type === 'work' 
                ? (shouldTakeLongBreak ? 'long-break' : 'short-break')
                : 'work'
        });

        // Show notification
        if (this.plugin.settings.pomodoroNotifications) {
            const message = session.type === 'work' 
                ? `Pomodoro completed! Time for a ${shouldTakeLongBreak ? 'long' : 'short'} break.`
                : 'Break completed! Ready for the next pomodoro?';
            new Notice(message);
        }

        // Play sound if enabled
        if (this.plugin.settings.pomodoroSoundEnabled) {
            this.playCompletionSound();
        }

        // Clear current session
        this.state.currentSession = undefined;
        this.state.isRunning = false;
        this.state.timeRemaining = 0;
        
        await this.saveState();

        // Auto-start next session if configured
        if (session.type === 'work' && this.plugin.settings.pomodoroAutoStartBreaks) {
            setTimeout(() => this.startBreak(shouldTakeLongBreak), 1000);
        } else if (session.type !== 'work' && this.plugin.settings.pomodoroAutoStartWork) {
            setTimeout(() => this.startPomodoro(), 1000);
        }
    }

    private async trackTimeOnTask(session: PomodoroSession) {
        if (!session.taskPath) return;

        const file = this.plugin.app.vault.getAbstractFileByPath(session.taskPath);
        if (!(file instanceof TFile)) return;

        try {
            await this.plugin.app.fileManager.processFrontMatter(file, (frontmatter) => {
                // Initialize time tracking fields if needed
                if (!frontmatter.timeEntries) {
                    frontmatter.timeEntries = [];
                }

                // Create time entry with new format
                const entry = {
                    startTime: session.startTime,
                    endTime: session.endTime!,
                    description: 'Pomodoro session'
                };
                frontmatter.timeEntries.push(entry);

                // Remove old timeSpent field if it exists
                delete frontmatter.timeSpent;

                // Update modified date using field mapper
                const dateModifiedField = this.plugin.fieldMapper.toUserField('dateModified');
                frontmatter[dateModifiedField] = format(new Date(), "yyyy-MM-dd'T'HH:mm:ss");
            });

            // Emit task update event
            this.plugin.emitter.emit('task-updated', { path: session.taskPath });
        } catch (error) {
            console.error('Failed to track time on task:', error);
        }
    }

    private async updateDailyNotePomodoros() {
        try {
            const dailyNotePath = `${this.plugin.settings.dailyNotesFolder}/${format(new Date(), 'yyyy-MM-dd')}.md`;
            // Updating daily note pomodoros
            let file = this.plugin.app.vault.getAbstractFileByPath(dailyNotePath);
            
            if (!(file instanceof TFile)) {
                // Daily note does not exist, creating
                // Ensure the daily notes folder exists
                await ensureFolderExists(this.plugin.app.vault, this.plugin.settings.dailyNotesFolder);
                
                const content = `---\ndate: ${format(new Date(), 'yyyy-MM-dd')}\npomodoros: 1\n---\n\n# ${format(new Date(), 'EEEE, MMMM d, yyyy')}\n\n## Pomodoros Completed: 1\n`;
                
                try {
                    file = await this.plugin.app.vault.create(dailyNotePath, content);
                    // Created daily note with 1 pomodoro
                } catch (createError: any) {
                    if (createError.message.includes('File already exists')) {
                        // File was created between our check and create attempt
                        // Daily note was created by another process, updating existing file
                        file = this.plugin.app.vault.getAbstractFileByPath(dailyNotePath);
                        if (file instanceof TFile) {
                            await this.plugin.app.fileManager.processFrontMatter(file, (frontmatter) => {
                                if (!frontmatter.pomodoros || typeof frontmatter.pomodoros !== 'number') {
                                    frontmatter.pomodoros = 0;
                                }
                                frontmatter.pomodoros++;
                                // Updated pomodoro count
                            });
                        }
                    } else {
                        throw createError;
                    }
                }
            } else {
                // Daily note exists, updating pomodoro count
                // Update existing daily note
                await this.plugin.app.fileManager.processFrontMatter(file, (frontmatter) => {
                    const oldCount = frontmatter.pomodoros || 0;
                    if (!frontmatter.pomodoros) {
                        frontmatter.pomodoros = 0;
                    }
                    frontmatter.pomodoros++;
                    // Updated pomodoro count
                });
            }
        } catch (error) {
            console.error('Failed to update daily note pomodoros:', error);
        }
    }

    private playCompletionSound() {
        try {
            // Create a simple beep sound
            const audioContext = new (window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext)();
            const oscillator = audioContext.createOscillator();
            const gainNode = audioContext.createGain();
            
            oscillator.connect(gainNode);
            gainNode.connect(audioContext.destination);
            
            const volume = Math.max(0, Math.min(1, this.plugin.settings.pomodoroSoundVolume / 100));
            gainNode.gain.value = volume * 0.3; // Scale down for comfortable listening
            
            oscillator.frequency.value = 800; // Frequency in Hz
            oscillator.type = 'sine';
            
            oscillator.start();
            oscillator.stop(audioContext.currentTime + 0.1); // 100ms beep
            
            // Second beep
            setTimeout(() => {
                try {
                    const osc2 = audioContext.createOscillator();
                    osc2.connect(gainNode);
                    osc2.frequency.value = 1000;
                    osc2.type = 'sine';
                    osc2.start();
                    osc2.stop(audioContext.currentTime + 0.1);
                } catch (error) {
                    console.error('Failed to play second beep:', error);
                }
            }, 150);
            
            // Clean up audio context after sounds complete
            setTimeout(() => {
                audioContext.close().catch(() => {});
            }, 300);
        } catch (error) {
            console.error('Failed to play completion sound:', error);
        }
    }

    // Public getters
    getState(): PomodoroState {
        return { ...this.state };
    }

    isRunning(): boolean {
        return this.state.isRunning;
    }

    getCurrentSession(): PomodoroSession | undefined {
        return this.state.currentSession;
    }

    getTimeRemaining(): number {
        return this.state.timeRemaining;
    }

    getPomodorosCompleted(): number {
        return this.state.pomodorosCompleted;
    }

    getCurrentStreak(): number {
        return this.state.currentStreak;
    }

    getTotalMinutesToday(): number {
        return this.state.totalMinutesToday;
    }

    async assignTaskToCurrentSession(task?: TaskInfo) {
        if (!this.state.currentSession) {
            return;
        }

        // Update the current session's task
        this.state.currentSession.taskPath = task?.path;
        await this.saveState();

        // Emit tick event to update UI
        this.plugin.emitter.emit(EVENT_POMODORO_TICK, { 
            timeRemaining: this.state.timeRemaining,
            session: this.state.currentSession 
        });
    }

    cleanup() {
        this.stopTimer();
        // Save final state before cleanup
        this.saveState().catch(error => {
            console.error('Failed to save final state:', error);
        });
    }
}