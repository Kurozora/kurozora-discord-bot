import { Resource } from './resource';
import { EditorialNotes } from './editorialNotes';
import { AlbumRelationship } from './albumRelationship';
import { GenreRelationship } from './genreRelationship';
import { MusicVideoRelationship } from './musicVideoRelationship';
import { PlaylistRelationship } from './playlistRelationship';
import { StationRelationship } from './stationRelationship';
export interface Artist extends Resource {
    attributes?: Artist.Attributes;
    relationships?: Artist.Relationships;
    type: 'artists';
}
declare namespace Artist {
    interface Attributes {
        editorialNotes?: EditorialNotes;
        genreNames: string[];
        name: string;
        url: string;
    }
    interface Relationships {
        albums?: AlbumRelationship;
        genres?: GenreRelationship;
        musicVideos?: MusicVideoRelationship;
        playlists?: PlaylistRelationship;
        station?: StationRelationship;
    }
}
export {};
//# sourceMappingURL=artist.d.ts.map