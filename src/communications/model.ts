import {z} from'zod';
export const SearchQuerySchema=z.object({q:z.string().trim().min(2).max(80)});
export const NotificationReadSchema=z.object({id:z.string().uuid()});
export const SupportStartSchema=z.object({targetMembershipId:z.string().uuid(),reason:z.string().trim().min(10).max(1000),durationMinutes:z.number().int().min(5).max(120).default(30)});
export const SupportEndSchema=z.object({id:z.string().uuid()});
export type SearchResult={type:string;id:string;title:string;description:string;href:string};
export type SupportSession={id:string;token:string;schoolId:string;targetAccountId:string;targetDisplayName:string;reason:string;expiresAt:string};
