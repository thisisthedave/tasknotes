declare module 'obsidian' {
  interface App {
    plugins: {
      getPlugin(id: 'obsidian-jira-issue'): JiraPlugin | undefined;
    };
  }
}

interface JiraPlugin {
  api: JiraAPI;
}

interface JiraAPI {
  base: {
    getIssue(issueKey: string, options?: { fields?: string[], account?: IJiraIssueAccountSettings }): Promise<IJiraIssue>;
    getSearchResults(query: string, options?: { limit?: number, offset?: number, fields?: string[], account?: IJiraIssueAccountSettings }): Promise<IJiraSearchResults>;
    getDevStatus(issueId: string, options?: { account?: IJiraIssueAccountSettings }): Promise<IJiraDevStatus>;
    getBoards(projectKeyOrId: string, options?: { limit?: number, offset?: number, account?: IJiraIssueAccountSettings }): Promise<IJiraBoard[]>;
    getSprint(sprintId: number, options?: { account?: IJiraIssueAccountSettings }): Promise<IJiraSprint>;
    getSprints(boardId: number, options?: { limit?: number, offset?: number, state?: ESprintState[], account?: IJiraIssueAccountSettings }): Promise<IJiraSprint[]>;
    getLoggedUser(account?: IJiraIssueAccountSettings): Promise<IJiraUser>;
  };
  // Add other API groups like macro, chart, util, etc. as needed
}

interface IJiraIssue {
    id: string
    key: string
    fields: {
        assignee: IJiraUser
        created: string
        creator: IJiraUser
        description: string
        duedate: string
        resolution: {
            name: string
            description: string
        }
        resolutiondate: string
        issuetype: {
            iconUrl: string
            name: string
        }
        priority: {
            iconUrl: string
            name: string
        }
        reporter: IJiraUser
        status: {
            statusCategory: {
                colorName: string
            }
            name: string
            description: string
        }
        summary: string
        updated: string
        environment: string
        project: {
            key: string
            name: string
        }
        labels: string[]
        fixVersions: {
            name: string
            description: string
            released: boolean
        }[]
        components: {
            name: string
        }[]
        aggregatetimeestimate: number
        aggregatetimeoriginalestimate: number
        aggregatetimespent: number
        timeestimate: number
        timeoriginalestimate: number
        timespent: number
        issueLinks: {
            type: {
                name: string
            }
            inwardIssue: {
                key: string
                fields: {
                    summary: string
                }
            }
        }[]
        aggregateprogress: {
            percent: number
        }
        progress: {
            percent: number
        }
        lastViewed: string
        worklog: {
            worklogs: IJiraWorklog[]
        }
        [k: string]: any
    }
    account: IJiraIssueAccountSettings
}

interface IJiraWorklog {
    id: string
    author: IJiraUser
    comment: string
    create: string
    started: string
    timeSpent: string
    timeSpentSeconds: number
    updateAuthor: IJiraUser
    updated: string
    issueKey?: string
}

interface IJiraUser {
    active: boolean
    displayName: string
    name: string
    key: string
    emailAddress: string
    self: string
    avatarUrls: {
        '16x16': string
        '24x24': string
        '32x32': string
        '48x48': string
    }
}

interface IJiraSearchResults {
    issues: IJiraIssue[]
    maxResults: number
    startAt: number
    total: number
    account: IJiraIssueAccountSettings
}

interface IJiraFieldSchema {
    customId: number
    type: string
    items?: string
}

interface IJiraAutocompleteDataField {
    value: string
    displayName: string
    auto: string
    orderable: string
    searchable: string
    cfid: string
    operators: [string]
    types: [string]
}

interface IJiraDevStatus {
    errors: []
    configErrors: []
    summary: {
        pullrequest: {
            overall: {
                count: number
                lastUpdated: string
                stateCount: number
                state: string
                details: {
                    openCount: number
                    mergedCount: number
                    declinedCount: number
                }
                open: boolean
            }
        }
        build: {
            overall: {
                count: number
            }
        }
        review: {
            overall: {
                count: number
            }
        }
        repository: {
            overall: {
                count: number
            }
        }
        branch: {
            overall: {
                count: number
            }
        }
    }
}

interface IJiraBoard {
    id: number
    name: string
    type: string
}

interface IJiraSprint {
    id: number
    state: ESprintState
    name: string
    startDate: string
    endDate: string
    completeDate: string
    activatedDate: string
    originBoardId: number
    goal: string
}

export enum ESprintState {
    CLOSED = 'closed',
    ACTIVE = 'active',
    FUTURE = 'future',
}

// settingsinterface.ts
export enum EAuthenticationTypes {
    OPEN = 'OPEN',
    BASIC = 'BASIC',
    CLOUD = 'CLOUD',
    BEARER_TOKEN = 'BEARER_TOKEN',
}

interface IJiraIssueAccountSettings {
    alias: string
    host: string
    authenticationType: EAuthenticationTypes
    username?: string
    password?: string
    bareToken?: string
    priority: number
    color: string
    cache: {
        statusColor: Record<string, string>
        customFieldsIdToName: Record<string, string>
        customFieldsNameToId: Record<string, string>
        customFieldsType: Record<string, IJiraFieldSchema>
        jqlAutocomplete: {
            fields: IJiraAutocompleteDataField[]
            functions: {
                [key: string]: [string]
            }
        }
    }
}

