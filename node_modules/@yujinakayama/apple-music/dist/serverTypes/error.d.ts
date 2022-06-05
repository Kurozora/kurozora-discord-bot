export interface Error {
    code: string;
    detail?: string;
    id: string;
    source?: Error.Source;
    status: string;
    title: string;
}
declare namespace Error {
    interface Source {
        parameter?: string;
        pointer?: any;
    }
}
export {};
//# sourceMappingURL=error.d.ts.map