import { Resource } from './resource';
import { Artwork } from './artwork';
import { EditorialNotes } from './editorialNotes';
import { PlayParameters } from './playParameters';
export interface Station extends Resource {
    attributes?: Station.Attributes;
    type: 'stations';
}
declare namespace Station {
    interface Attributes {
        artwork: Artwork;
        durationInMillis?: number;
        editorialNotes?: EditorialNotes;
        episodeNumber?: number;
        isLive: boolean;
        name: string;
        playParams?: PlayParameters;
        url: string;
    }
}
export {};
//# sourceMappingURL=station.d.ts.map