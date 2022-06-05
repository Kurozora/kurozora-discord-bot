import { Resource } from './resource';
export interface Relationship {
    data?: Resource[];
    href?: string;
    meta?: Relationship.Meta;
    next?: string;
}
declare namespace Relationship {
    interface Meta {
    }
}
export {};
//# sourceMappingURL=relationship.d.ts.map