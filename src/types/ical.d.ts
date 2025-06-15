declare module 'ical.js' {
    export interface ParsedComponent {
        [key: string]: any;
    }

    export class Component {
        constructor(jcal: any);
        getAllSubcomponents(name: string): Component[];
    }

    export class Event {
        constructor(component: Component);
        uid: string;
        summary: string;
        description?: string;
        location?: string;
        url?: string;
        startDate: Time;
        endDate?: Time;
        isRecurring(): boolean;
        iterator(startDate?: Time): EventIterator;
    }

    export class Time {
        constructor();
        isDate: boolean;
        fromJSDate(date: Date): void;
        toJSDate(): Date;
        compare(other: Time): number;
    }

    export interface EventIterator {
        next(): Time | null;
    }

    export function parse(input: string): ParsedComponent;
}