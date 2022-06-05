import { Resource } from './resource';
import { Artwork } from './artwork';
import { EditorialNotes } from './editorialNotes';
import { PlaylistRelationship } from './playlistRelationship';
export interface Curator extends Resource {
    attributes?: Curator.Attributes;
    relationships?: Curator.Relationships;
    type: 'curators';
}
declare namespace Curator {
    interface Attributes {
        artwork: Artwork;
        editorialNotes?: EditorialNotes;
        name: string;
        url: string;
    }
    interface Relationships {
        playlists?: PlaylistRelationship;
    }
}
export {};
//# sourceMappingURL=curator.d.ts.map