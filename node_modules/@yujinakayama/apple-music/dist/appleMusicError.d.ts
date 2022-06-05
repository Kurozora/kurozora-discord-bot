import { ResponseRoot } from './serverTypes/responseRoot';
export declare class AppleMusicError extends Error {
    httpStatusCode: number;
    response?: ResponseRoot | undefined;
    constructor(message: string, httpStatusCode: number, response?: ResponseRoot | undefined);
}
//# sourceMappingURL=appleMusicError.d.ts.map