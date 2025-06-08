import { ItemView, WorkspaceLeaf, Setting } from 'obsidian';
import { format, subDays, startOfWeek, endOfWeek } from 'date-fns';
import TaskNotesPlugin from '../main';
import { 
    POMODORO_STATS_VIEW_TYPE,
    PomodoroHistoryStats,
    PomodoroSessionHistory
} from '../types';

export class PomodoroStatsView extends ItemView {
    plugin: TaskNotesPlugin;
    
    // UI elements
    private todayStatsEl: HTMLElement | null = null;
    private weekStatsEl: HTMLElement | null = null;
    private recentSessionsEl: HTMLElement | null = null;
    private overallStatsEl: HTMLElement | null = null;
    
    constructor(leaf: WorkspaceLeaf, plugin: TaskNotesPlugin) {
        super(leaf);
        this.plugin = plugin;
    }
    
    getViewType(): string {
        return POMODORO_STATS_VIEW_TYPE;
    }
    
    getDisplayText(): string {
        return 'Pomodoro Stats';
    }
    
    getIcon(): string {
        return 'bar-chart';
    }
    
    async onOpen() {
        await this.plugin.onReady();
        await this.render();
    }
    
    async onClose() {
        this.contentEl.empty();
    }
    
    async render() {
        const container = this.contentEl.createDiv({ cls: 'tasknotes-container pomodoro-stats-container' });
        
        // Header
        const header = container.createDiv({ cls: 'pomodoro-stats-header' });
        new Setting(header)
            .setName('Pomodoro Statistics')
            .setHeading();
        
        // Refresh button
        const refreshButton = header.createEl('button', { 
            cls: 'pomodoro-stats-refresh-button',
            text: 'Refresh'
        });
        this.registerDomEvent(refreshButton, 'click', () => {
            this.refreshStats();
        });
        
        // Today's stats
        const todaySection = container.createDiv({ cls: 'pomodoro-stats-section' });
        new Setting(todaySection)
            .setName('Today')
            .setHeading();
        this.todayStatsEl = todaySection.createDiv({ cls: 'pomodoro-stats-grid' });
        
        // This week's stats
        const weekSection = container.createDiv({ cls: 'pomodoro-stats-section' });
        new Setting(weekSection)
            .setName('This Week')
            .setHeading();
        this.weekStatsEl = weekSection.createDiv({ cls: 'pomodoro-stats-grid' });
        
        // Overall stats
        const overallSection = container.createDiv({ cls: 'pomodoro-stats-section' });
        new Setting(overallSection)
            .setName('All Time')
            .setHeading();
        this.overallStatsEl = overallSection.createDiv({ cls: 'pomodoro-stats-grid' });
        
        // Recent sessions
        const recentSection = container.createDiv({ cls: 'pomodoro-stats-section' });
        new Setting(recentSection)
            .setName('Recent Sessions')
            .setHeading();
        this.recentSessionsEl = recentSection.createDiv({ cls: 'pomodoro-recent-sessions' });
        
        // Initial load
        await this.refreshStats();
    }
    
    private async refreshStats() {
        try {
            await Promise.all([
                this.updateTodayStats(),
                this.updateWeekStats(),
                this.updateOverallStats(),
                this.updateRecentSessions()
            ]);
        } catch (error) {
            console.error('Failed to refresh stats:', error);
        }
    }
    
    private async updateTodayStats() {
        if (!this.todayStatsEl) return;
        
        const stats = await this.plugin.pomodoroService.getTodayStats();
        this.renderStatsGrid(this.todayStatsEl, stats);
    }
    
    private async updateWeekStats() {
        if (!this.weekStatsEl) return;
        
        const today = new Date();
        const weekStart = startOfWeek(today, { weekStartsOn: 1 }); // Monday
        const weekEnd = endOfWeek(today, { weekStartsOn: 1 });
        
        const stats = await this.calculateStatsForRange(weekStart, weekEnd);
        this.renderStatsGrid(this.weekStatsEl, stats);
    }
    
    private async updateOverallStats() {
        if (!this.overallStatsEl) return;
        
        const history = await this.plugin.pomodoroService.getSessionHistory();
        const stats = this.calculateOverallStats(history);
        this.renderStatsGrid(this.overallStatsEl, stats);
    }
    
    private async updateRecentSessions() {
        if (!this.recentSessionsEl) return;
        
        const history = await this.plugin.pomodoroService.getSessionHistory();
        const recentSessions = history
            .filter(session => session.type === 'work')
            .slice(-10)
            .reverse();
        
        this.recentSessionsEl.empty();
        
        if (recentSessions.length === 0) {
            this.recentSessionsEl.createDiv({ 
                cls: 'pomodoro-no-sessions',
                text: 'No sessions recorded yet'
            });
            return;
        }
        
        for (const session of recentSessions) {
            const sessionEl = this.recentSessionsEl.createDiv({ cls: 'pomodoro-session-item' });
            
            const dateEl = sessionEl.createSpan({ cls: 'session-date' });
            dateEl.textContent = format(new Date(session.startTime), 'MMM d, HH:mm');
            
            const durationEl = sessionEl.createSpan({ cls: 'session-duration' });
            durationEl.textContent = `${session.duration}min`;
            
            const statusEl = sessionEl.createSpan({ cls: 'session-status' });
            statusEl.textContent = session.completed ? 'Completed' : 'Interrupted';
            statusEl.addClass(session.completed ? 'status-completed' : 'status-interrupted');
            
            if (session.taskPath) {
                const taskEl = sessionEl.createSpan({ cls: 'session-task' });
                const taskName = session.taskPath.split('/').pop()?.replace('.md', '') || '';
                taskEl.textContent = taskName;
            }
        }
    }
    
    private renderStatsGrid(container: HTMLElement, stats: PomodoroHistoryStats) {
        container.empty();
        
        // Completed pomodoros
        const pomodorosCard = container.createDiv({ cls: 'pomodoro-stat-card' });
        pomodorosCard.createDiv({ cls: 'stat-value', text: stats.pomodorosCompleted.toString() });
        pomodorosCard.createDiv({ cls: 'stat-label', text: 'Pomodoros' });
        
        // Current streak
        const streakCard = container.createDiv({ cls: 'pomodoro-stat-card' });
        streakCard.createDiv({ cls: 'stat-value', text: stats.currentStreak.toString() });
        streakCard.createDiv({ cls: 'stat-label', text: 'Streak' });
        
        // Total minutes
        const minutesCard = container.createDiv({ cls: 'pomodoro-stat-card' });
        minutesCard.createDiv({ cls: 'stat-value', text: stats.totalMinutes.toString() });
        minutesCard.createDiv({ cls: 'stat-label', text: 'Minutes' });
        
        // Average session length
        const avgCard = container.createDiv({ cls: 'pomodoro-stat-card' });
        avgCard.createDiv({ cls: 'stat-value', text: stats.averageSessionLength.toString() });
        avgCard.createDiv({ cls: 'stat-label', text: 'Avg Length' });
        
        // Completion rate
        const rateCard = container.createDiv({ cls: 'pomodoro-stat-card' });
        rateCard.createDiv({ cls: 'stat-value', text: `${stats.completionRate}%` });
        rateCard.createDiv({ cls: 'stat-label', text: 'Completion' });
    }
    
    private async calculateStatsForRange(startDate: Date, endDate: Date): Promise<PomodoroHistoryStats> {
        const history = await this.plugin.pomodoroService.getSessionHistory();
        
        // Filter sessions within date range
        const rangeSessions = history.filter(session => {
            const sessionDate = new Date(session.startTime);
            return sessionDate >= startDate && sessionDate <= endDate;
        });
        
        return this.calculateStatsFromSessions(rangeSessions);
    }
    
    private calculateOverallStats(history: PomodoroSessionHistory[]): PomodoroHistoryStats {
        return this.calculateStatsFromSessions(history);
    }
    
    private calculateStatsFromSessions(sessions: PomodoroSessionHistory[]): PomodoroHistoryStats {
        // Filter work sessions only
        const workSessions = sessions.filter(session => session.type === 'work');
        const completedWork = workSessions.filter(session => session.completed);
        
        // Calculate streak from most recent sessions
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
}