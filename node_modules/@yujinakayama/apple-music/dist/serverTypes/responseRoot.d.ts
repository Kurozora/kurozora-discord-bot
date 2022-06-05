import { Resource } from './resource';
import { Error } from './error';
export interface ResponseRoot {
    data?: Resource[];
    errors?: Error[];
    href?: string;
    meta?: ResponseRoot.Meta;
    next?: string;
    results?: ResponseRoot.Results;
}
declare namespace ResponseRoot {
    interface Meta {
    }
    interface Results {
    }
}
export {};
//# sourceMappingURL=responseRoot.d.ts.map