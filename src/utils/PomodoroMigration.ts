/**
 * Pomodoro Data Migration Utility
 * 
 * This file handles migration from the old Pomodoro session format to the new
 * activePeriods-based format introduced in v2.2.0.
 * 
 * Migration can be safely removed in a future version once the user base
 * has migrated to the new format.
 * 
 * @since 2.2.0
 * @deprecated Can be removed in v2.4.0+ when migration is no longer needed
 */

import { PomodoroSession, PomodoroSessionHistory, PomodoroTimePeriod } from '../types';
import { getCurrentTimestamp } from './dateUtils';

/**
 * Legacy session format (pre-v2.2.0)
 */
interface LegacyPomodoroSession {
    id: string;
    taskPath?: string;
    startTime: string;
    endTime?: string;
    duration: number; // This was planned duration
    type: 'work' | 'short-break' | 'long-break';
    completed: boolean;
    interrupted?: boolean;
}

/**
 * Legacy session history format (pre-v2.2.0)
 */
interface LegacyPomodoroSessionHistory {
    id: string;
    startTime: string;
    endTime: string;
    duration: number; // This was calculated actual duration
    plannedDuration: number;
    type: 'work' | 'short-break' | 'long-break';
    taskPath?: string;
    completed: boolean;
}

/**
 * Migration version tracking
 */
export const POMODORO_MIGRATION_VERSION = '2.2.0';
export const MIGRATION_KEY = 'pomodoroMigrationVersion';

/**
 * Check if data needs migration
 */
export function needsMigration(data: any): boolean {
    // No migration version means old format
    if (!data[MIGRATION_KEY]) {
        return true;
    }
    
    // Check if current migration version is newer
    return data[MIGRATION_KEY] !== POMODORO_MIGRATION_VERSION;
}

/**
 * Migrate legacy PomodoroSession to new format
 */
export function migrateLegacySession(legacySession: any): PomodoroSession {
    // Check if already in new format
    if (legacySession.activePeriods && legacySession.plannedDuration !== undefined) {
        return legacySession as PomodoroSession;
    }
    
    const legacy = legacySession as LegacyPomodoroSession;
    
    // Create activePeriods array based on legacy data
    const activePeriods: PomodoroTimePeriod[] = [];
    
    // If session was completed/interrupted, reconstruct the active period
    if (legacy.endTime) {
        activePeriods.push({
            startTime: legacy.startTime,
            endTime: legacy.endTime
        });
    } else {
        // Session is still active, create open period
        activePeriods.push({
            startTime: legacy.startTime
            // No endTime = currently active
        });
    }
    
    // Convert to new format
    const migratedSession: PomodoroSession = {
        id: legacy.id,
        taskPath: legacy.taskPath,
        startTime: legacy.startTime,
        endTime: legacy.endTime,
        plannedDuration: legacy.duration, // Old 'duration' was planned duration
        type: legacy.type,
        completed: legacy.completed,
        interrupted: legacy.interrupted,
        activePeriods: activePeriods
    };
    
    return migratedSession;
}

/**
 * Migrate legacy PomodoroSessionHistory to new format
 */
export function migrateLegacySessionHistory(legacyHistory: any): PomodoroSessionHistory {
    // Check if already in new format
    if (legacyHistory.activePeriods) {
        return legacyHistory as PomodoroSessionHistory;
    }
    
    const legacy = legacyHistory as LegacyPomodoroSessionHistory;
    
    // Reconstruct activePeriods from legacy data
    // In legacy format, 'duration' was the actual time worked
    // We need to create a single active period that represents this
    const activePeriods: PomodoroTimePeriod[] = [{
        startTime: legacy.startTime,
        endTime: legacy.endTime
    }];
    
    // Convert to new format
    const migratedHistory: PomodoroSessionHistory = {
        id: legacy.id,
        startTime: legacy.startTime,
        endTime: legacy.endTime,
        plannedDuration: legacy.plannedDuration,
        type: legacy.type,
        taskPath: legacy.taskPath,
        completed: legacy.completed,
        activePeriods: activePeriods
    };
    
    return migratedHistory;
}

/**
 * Migrate complete pomodoro data structure
 */
export function migrateAllPomodoroData(data: any): any {
    const migratedData = { ...data };
    
    // Migrate current session if it exists
    if (migratedData.pomodoroState?.currentSession) {
        migratedData.pomodoroState.currentSession = migrateLegacySession(
            migratedData.pomodoroState.currentSession
        );
    }
    
    // Migrate session history if it exists
    if (migratedData.pomodoroHistory && Array.isArray(migratedData.pomodoroHistory)) {
        migratedData.pomodoroHistory = migratedData.pomodoroHistory.map(
            (session: any) => migrateLegacySessionHistory(session)
        );
    }
    
    // Mark as migrated
    migratedData[MIGRATION_KEY] = POMODORO_MIGRATION_VERSION;
    
    return migratedData;
}

/**
 * Backward compatibility helper for calculating duration
 * Can be used in stats calculations to handle both old and new formats
 */
export function getSessionDuration(session: any): number {
    // New format: calculate from activePeriods
    if (session.activePeriods && Array.isArray(session.activePeriods)) {
        return session.activePeriods
            .filter((period: PomodoroTimePeriod) => period.endTime)
            .reduce((total: number, period: PomodoroTimePeriod) => {
                const start = new Date(period.startTime);
                const end = new Date(period.endTime!);
                const durationMs = end.getTime() - start.getTime();
                return total + Math.round(durationMs / (1000 * 60)); // minutes
            }, 0);
    }
    
    // Legacy format: use duration field
    if (session.duration !== undefined) {
        return session.duration;
    }
    
    // Fallback: calculate from start/end times
    if (session.startTime && session.endTime) {
        const start = new Date(session.startTime);
        const end = new Date(session.endTime);
        const durationMs = end.getTime() - start.getTime();
        return Math.round(durationMs / (1000 * 60)); // minutes
    }
    
    return 0;
}

/**
 * Log migration information for debugging
 */
export function logMigrationInfo(originalData: any, migratedData: any): void {
    const currentSessionMigrated = originalData.pomodoroState?.currentSession && 
        !originalData.pomodoroState.currentSession.activePeriods;
    
    const historyCount = originalData.pomodoroHistory?.length || 0;
    const historyMigrated = historyCount > 0 && 
        !originalData.pomodoroHistory[0]?.activePeriods;
    
    console.log('[PomodoroMigration] Migration completed:', {
        version: POMODORO_MIGRATION_VERSION,
        currentSessionMigrated,
        historySessionsMigrated: historyMigrated ? historyCount : 0,
        totalDataSizeBefore: JSON.stringify(originalData).length,
        totalDataSizeAfter: JSON.stringify(migratedData).length
    });
}