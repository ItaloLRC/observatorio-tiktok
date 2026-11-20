export const PACE={navigationDelayMs:30000,scrollDelayMs:5000,replyBatchSize:1};
export function due(pending,time=Date.now()){return !!pending&&time>=pending.dueAt;}
