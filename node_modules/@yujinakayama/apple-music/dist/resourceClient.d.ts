import { ClientConfiguration } from './clientConfiguration';
import { ResponseRoot } from './serverTypes/responseRoot';
export declare class ResourceClient<T extends ResponseRoot> {
    urlName: string;
    configuration: ClientConfiguration;
    private axiosInstance;
    constructor(urlName: string, configuration: ClientConfiguration);
    get(id: string, options?: {
        storefront?: string;
        languageTag?: string;
    }): Promise<T>;
    private request;
}
//# sourceMappingURL=resourceClient.d.ts.map