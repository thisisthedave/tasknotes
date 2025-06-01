import { ItemView, WorkspaceLeaf, Notice } from 'obsidian';
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
import { TaskSelectorModal } from '../modals/TaskSelectorModal';

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
    private taskSelectButton: HTMLButtonElement | null = null;
    private currentSelectedTask: TaskInfo | null = null;
    
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
        
        // Clear cached references to prevent memory leaks
        this.timerDisplay = null;
        this.statusDisplay = null;
        this.startButton = null;
        this.pauseButton = null;
        this.stopButton = null;
        this.taskDisplay = null;
        this.statsDisplay = null;
        this.taskSelectButton = null;
        this.currentSelectedTask = null;
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
        
        const taskSelectorContainer = taskSelectorSection.createDiv({ cls: 'pomodoro-task-selector-container' });
        
        this.taskSelectButton = taskSelectorContainer.createEl('button', { 
            cls: 'pomodoro-task-select-button',
            text: 'Choose task...'
        });
        
        // Add click handler for task selector button
        this.taskSelectButton.addEventListener('click', async () => {
            await this.openTaskSelector();
        });
        
        // Add clear button
        const clearButton = taskSelectorContainer.createEl('button', {
            cls: 'pomodoro-task-clear-button',
            text: 'Clear'
        });
        
        clearButton.addEventListener('click', async () => {
            await this.selectTask(null);
        });
        
        // Load and restore last selected task
        this.restoreLastSelectedTask();
        
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
            // Prevent double clicks
            if (this.startButton!.hasClass('is-loading')) return;
            this.startButton!.addClass('is-loading');
            
            try {
                const state = this.plugin.pomodoroService.getState();
                if (state.currentSession && !state.isRunning) {
                    await this.plugin.pomodoroService.resumePomodoro();
                } else {
                    await this.plugin.pomodoroService.startPomodoro(this.currentSelectedTask || undefined);
                }
            } finally {
                this.startButton!.removeClass('is-loading');
            }
        });
        
        this.pauseButton.addEventListener('click', () => {
            this.plugin.pomodoroService.pausePomodoro();
        });
        
        this.stopButton.addEventListener('click', () => {
            this.plugin.pomodoroService.stopPomodoro();
        });
        
        workButton.addEventListener('click', async () => {
            await this.plugin.pomodoroService.startPomodoro(this.currentSelectedTask || undefined);
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
        
        // Update initial timer based on current state
        const state = this.plugin.pomodoroService.getState();
        this.updateTimer(state.timeRemaining);
    }
    
    private async openTaskSelector() {
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
            
            // Remove duplicates
            const uniqueTasks = tasks.filter((task, index, arr) => 
                arr.findIndex(t => t.path === task.path) === index
            );
            
            if (uniqueTasks.length === 0) {
                new Notice('No tasks found. Create some tasks first.');
                return;
            }
            
            // Open task selector modal
            const modal = new TaskSelectorModal(this.app, uniqueTasks, (selectedTask) => {
                this.selectTask(selectedTask);
            });
            
            modal.open();
            
        } catch (error) {
            console.error('Error opening task selector:', error);
            new Notice('Failed to load tasks');
        }
    }
    
    private async selectTask(task: TaskInfo | null) {
        this.currentSelectedTask = task;
        
        // Update button text
        if (this.taskSelectButton) {
            if (task) {
                const displayText = task.title.length > 30 
                    ? task.title.substring(0, 27) + '...' 
                    : task.title;
                this.taskSelectButton.textContent = displayText;
                this.taskSelectButton.title = task.title; // Full title in tooltip
                this.taskSelectButton.removeClass('pomodoro-no-task');
            } else {
                this.taskSelectButton.textContent = 'Choose task...';
                this.taskSelectButton.title = '';
                this.taskSelectButton.addClass('pomodoro-no-task');
            }
        }
        
        // Save selection for persistence
        await this.plugin.pomodoroService.saveLastSelectedTask(task?.path);
        
        // If there's a current work session, update its task assignment
        const state = this.plugin.pomodoroService.getState();
        if (state.currentSession && state.currentSession.type === 'work') {
            await this.plugin.pomodoroService.assignTaskToCurrentSession(task || undefined);
        }
    }
    
    private async restoreLastSelectedTask() {
        try {
            const lastTaskPath = await this.plugin.pomodoroService.getLastSelectedTaskPath();
            if (lastTaskPath) {
                // Try to find the task by path
                const today = new Date();
                
                // Search in tasks from the last week to today and next week
                for (let i = -7; i <= 7; i++) {
                    const date = new Date(today);
                    date.setDate(today.getDate() + i);
                    
                    try {
                        const dayTasks = await this.plugin.fileIndexer.getTaskInfoForDate(date);
                        const task = dayTasks.find(t => t.path === lastTaskPath);
                        
                        if (task && task.status !== 'done' && !task.archived) {
                            await this.selectTask(task);
                            return;
                        }
                    } catch (error) {
                        // Continue searching
                    }
                }
            }
        } catch (error) {
            console.error('Error restoring last selected task:', error);
        }
    }
    
    private async updateTaskButtonFromPath(taskPath: string) {
        try {
            // Try to get task info for display
            const today = new Date();
            
            for (let i = -7; i <= 7; i++) {
                const date = new Date(today);
                date.setDate(today.getDate() + i);
                
                try {
                    const dayTasks = await this.plugin.fileIndexer.getTaskInfoForDate(date);
                    const task = dayTasks.find(t => t.path === taskPath);
                    
                    if (task) {
                        this.currentSelectedTask = task;
                        if (this.taskSelectButton) {
                            const displayText = task.title.length > 30 
                                ? task.title.substring(0, 27) + '...' 
                                : task.title;
                            this.taskSelectButton.textContent = displayText;
                            this.taskSelectButton.title = task.title;
                            this.taskSelectButton.removeClass('pomodoro-no-task');
                        }
                        return;
                    }
                } catch (error) {
                    // Continue searching
                }
            }
        } catch (error) {
            console.error('Error updating task button from path:', error);
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
        
        // Update task selector button to reflect current session
        if (this.taskSelectButton) {
            if (state.currentSession?.taskPath && !this.currentSelectedTask) {
                // Try to get the task info for display
                this.updateTaskButtonFromPath(state.currentSession.taskPath);
            }
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
            // Ensure seconds is valid
            const validSeconds = Math.max(0, Math.floor(seconds));
            const minutes = Math.floor(validSeconds / 60);
            const secs = validSeconds % 60;
            this.timerDisplay.textContent = `${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
            
            // Update timer color based on time remaining
            if (validSeconds <= 60 && validSeconds > 0) {
                this.timerDisplay.addClass('pomodoro-timer-warning');
            } else {
                this.timerDisplay.removeClass('pomodoro-timer-warning');
            }
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