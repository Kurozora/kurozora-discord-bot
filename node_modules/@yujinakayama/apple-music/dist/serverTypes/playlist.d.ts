import { Resource } from './resource';
import { Artwork } from './artwork';
import { EditorialNotes } from './editorialNotes';
import { PlayParameters } from './playParameters';
import { CuratorRelationship } from './curatorRelationship';
import { TrackRelationship } from './trackRelationship';
export interface Playlist extends Resource {
    attributes?: Playlist.Attributes;
    relationships?: Playlist.Relationships;
    type: 'playlists';
}
declare namespace Playlist {
    interface Attributes {
        artwork?: Artwork;
        curatorName?: string;
        description?: EditorialNotes;
        lastModifiedDate: Date;
        name: string;
        playParams?: PlayParameters;
        playlistType: 'user-shared' | 'editorial' | 'external' | 'personal-mix';
        url: string;
    }
    interface Relationships {
        curator?: CuratorRelationship;
        tracks?: TrackRelationship;
    }
}
export {};
//# sourceMappingURL=playlist.d.ts.map