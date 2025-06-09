import { Notice, TFile } from 'obsidian';
import { format } from 'date-fns';
import TaskNotesPlugin from '../main';
import { 
    PomodoroSession, 
    PomodoroState,
    PomodoroSessionHistory,
    PomodoroHistoryStats,
    EVENT_POMODORO_START, 
    EVENT_POMODORO_COMPLETE, 
    EVENT_POMODORO_INTERRUPT, 
    EVENT_POMODORO_TICK,
    EVENT_TASK_UPDATED,
    TaskInfo,
    TimeEntry
} from '../types';
import { ensureFolderExists } from '../utils/helpers';

export class PomodoroService {
    private plugin: TaskNotesPlugin;
    private timerInterval: NodeJS.Timeout | null = null;
    private state: PomodoroState;
    private stateFile = 'pomodoro-state.json';
    private activeAudioContexts: Set<AudioContext> = new Set();
    private cleanupTimeouts: Set<NodeJS.Timeout> = new Set();
    private visibilityChangeHandler: (() => void) | null = null;

    constructor(plugin: TaskNotesPlugin) {
        this.plugin = plugin;
        this.state = {
            isRunning: false,
            timeRemaining: plugin.settings.pomodoroWorkDuration * 60 // Default work duration in seconds
        };
    }

    async initialize() {
        await this.loadState();
        
        // Resume timer if it was running
        if (this.state.isRunning && this.state.currentSession) {
            this.resumeTimer();
        }
        
        // Listen for visibility changes to handle app suspension/resume
        this.visibilityChangeHandler = () => {
            if (!document.hidden && this.state.isRunning && this.state.currentSession) {
                // App became visible again, check if timer needs adjustment
                this.resumeTimer();
            }
        };
        this.plugin.registerDomEvent(document, 'visibilitychange', this.visibilityChangeHandler);
    }

    async loadState() {
        try {
            const data = await this.plugin.loadData();
            if (data?.pomodoroState) {
                this.state = data.pomodoroState;
                
                // Validate loaded state
                this.state.timeRemaining = Math.max(0, this.state.timeRemaining || 0);
                
                // Clear any stale session from previous day
                const today = format(new Date(), 'yyyy-MM-dd');
                const lastDate = data.lastPomodoroDate;
                if (lastDate !== today) {
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
                timeRemaining: this.plugin.settings.pomodoroWorkDuration * 60
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
        
        // Start time tracking on the task if applicable
        if (task) {
            try {
                await this.plugin.taskService.startTimeTracking(task);
            } catch (error) {
                // If time tracking is already active, that's fine for Pomodoro
                if (!error.message?.includes('Time tracking is already active')) {
                    console.error('Failed to start time tracking for Pomodoro:', error);
                }
            }
        }
        
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
            
            // Add interrupted session to history
            await this.addSessionToHistory(this.state.currentSession);
        }

        this.plugin.emitter.emit(EVENT_POMODORO_INTERRUPT, { session: this.state.currentSession });

        // Stop time tracking on the task if applicable
        if (this.state.currentSession && this.state.currentSession.taskPath) {
            try {
                const task = await this.plugin.cacheManager.getTaskInfo(this.state.currentSession.taskPath, false);
                if (task) {
                    await this.plugin.taskService.stopTimeTracking(task);
                }
            } catch (error) {
                console.error('Failed to stop time tracking for Pomodoro interrupt:', error);
            }
        }

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

        // Stop time tracking on task if applicable for work sessions
        if (session.type === 'work') {
            // Stop time tracking on task if applicable
            if (session.taskPath) {
                try {
                    const task = await this.plugin.cacheManager.getTaskInfo(session.taskPath, false);
                    if (task) {
                        await this.plugin.taskService.stopTimeTracking(task);
                    }
                } catch (error) {
                    console.error('Failed to stop time tracking for Pomodoro completion:', error);
                }
            }

            // Update daily note with pomodoro count
            await this.updateDailyNotePomodoros();
        }

        // Determine next session based on session history
        let shouldTakeLongBreak = false;
        if (session.type === 'work') {
            try {
                const stats = await this.getTodayStats();
                shouldTakeLongBreak = stats.pomodorosCompleted % this.plugin.settings.pomodoroLongBreakInterval === 0;
            } catch (error) {
                console.error('Failed to calculate break type:', error);
                shouldTakeLongBreak = false;
            }
        }

        // Add session to history
        await this.addSessionToHistory(session);

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
            const timeout = setTimeout(() => this.startBreak(shouldTakeLongBreak), 1000);
            this.cleanupTimeouts.add(timeout);
        } else if (session.type !== 'work' && this.plugin.settings.pomodoroAutoStartWork) {
            const timeout = setTimeout(() => this.startPomodoro(), 1000);
            this.cleanupTimeouts.add(timeout);
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
            
            // Track audio context for cleanup
            this.activeAudioContexts.add(audioContext);
            
            // Second beep
            const beepTimeout = setTimeout(() => {
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
            this.cleanupTimeouts.add(beepTimeout);
            
            // Clean up audio context after sounds complete
            const cleanupTimeout = setTimeout(() => {
                this.activeAudioContexts.delete(audioContext);
                audioContext.close().catch(() => {});
            }, 300);
            this.cleanupTimeouts.add(cleanupTimeout);
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

    async getPomodorosCompleted(): Promise<number> {
        const stats = await this.getTodayStats();
        return stats.pomodorosCompleted;
    }

    async getCurrentStreak(): Promise<number> {
        const stats = await this.getTodayStats();
        return stats.currentStreak;
    }

    async getTotalMinutesToday(): Promise<number> {
        const stats = await this.getTodayStats();
        return stats.totalMinutes;
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


    // Session History Management
    async getSessionHistory(): Promise<PomodoroSessionHistory[]> {
        try {
            const data = await this.plugin.loadData();
            return data?.pomodoroHistory || [];
        } catch (error) {
            console.error('Failed to load session history:', error);
            return [];
        }
    }

    async saveSessionHistory(history: PomodoroSessionHistory[]): Promise<void> {
        try {
            const data = await this.plugin.loadData() || {};
            data.pomodoroHistory = history;
            await this.plugin.saveData(data);
        } catch (error) {
            console.error('Failed to save session history:', error);
        }
    }

    async addSessionToHistory(session: PomodoroSession): Promise<void> {
        if (!session.endTime) {
            console.warn('Cannot add session to history without end time');
            return;
        }

        const startTime = new Date(session.startTime);
        const endTime = new Date(session.endTime);
        const actualDuration = Math.round((endTime.getTime() - startTime.getTime()) / (1000 * 60)); // minutes

        const historyEntry: PomodoroSessionHistory = {
            id: session.id,
            startTime: session.startTime,
            endTime: session.endTime,
            duration: actualDuration,
            plannedDuration: session.duration,
            type: session.type,
            taskPath: session.taskPath,
            completed: session.completed && !session.interrupted
        };

        try {
            const history = await this.getSessionHistory();
            history.push(historyEntry);
            await this.saveSessionHistory(history);
        } catch (error) {
            console.error('Failed to add session to history:', error);
        }
    }

    async getStatsForDate(date: Date): Promise<PomodoroHistoryStats> {
        const dateStr = format(date, 'yyyy-MM-dd');
        const history = await this.getSessionHistory();
        
        // Filter sessions for the specific date
        const dayHistory = history.filter(session => {
            const sessionDate = format(new Date(session.startTime), 'yyyy-MM-dd');
            return sessionDate === dateStr;
        });

        // Calculate stats for work sessions only
        const workSessions = dayHistory.filter(session => session.type === 'work');
        const completedWork = workSessions.filter(session => session.completed);

        // Calculate current streak (consecutive completed work sessions from latest backwards)
        let currentStreak = 0;
        for (let i = workSessions.length - 1; i >= 0; i--) {
            if (workSessions[i].completed) {
                currentStreak++;
            } else {
                break;
            }
        }

        const totalMinutes = completedWork.reduce((sum, session) => sum + session.duration, 0);
        const averageSessionLength = completedWork.length > 0 
            ? totalMinutes / completedWork.length 
            : 0;
        const completionRate = workSessions.length > 0 
            ? (completedWork.length / workSessions.length) * 100 
            : 0;

        return {
            pomodorosCompleted: completedWork.length,
            currentStreak,
            totalMinutes,
            averageSessionLength: Math.round(averageSessionLength),
            completionRate: Math.round(completionRate)
        };
    }

    async getTodayStats(): Promise<PomodoroHistoryStats> {
        return this.getStatsForDate(new Date());
    }

    cleanup() {
        this.stopTimer();
        
        // Clean up all timeouts
        for (const timeout of this.cleanupTimeouts) {
            clearTimeout(timeout);
        }
        this.cleanupTimeouts.clear();
        
        // Clean up all active audio contexts
        for (const audioContext of this.activeAudioContexts) {
            try {
                if (audioContext.state !== 'closed') {
                    audioContext.close().catch(() => {});
                }
            } catch (error) {
                // Ignore cleanup errors
            }
        }
        this.activeAudioContexts.clear();
        
        // Visibility change handler will be cleaned up automatically by Obsidian
        // when the plugin is unloaded, since we used registerDomEvent
        this.visibilityChangeHandler = null;
        
        // Save final state before cleanup
        this.saveState().catch(error => {
            console.error('Failed to save final state:', error);
        });
    }
}