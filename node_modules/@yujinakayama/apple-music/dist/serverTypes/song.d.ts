import { CalendarDate } from '../calendarDate';
import { Resource } from './resource';
import { Artwork } from './artwork';
import { ContentRating } from './contentRating';
import { EditorialNotes } from './editorialNotes';
import { PlayParameters } from './playParameters';
import { Preview } from './preview';
import { AlbumRelationship } from './albumRelationship';
import { ArtistRelationship } from './artistRelationship';
import { GenreRelationship } from './genreRelationship';
import { StationRelationship } from './stationRelationship';
export interface Song extends Resource {
    attributes?: Song.Attributes;
    relationships?: Song.Relationships;
    type: 'songs';
}
declare namespace Song {
    interface Attributes {
        albumName: string;
        artistName: string;
        artwork: Artwork;
        composerName?: string;
        contentRating?: ContentRating;
        discNumber: number;
        durationInMillis?: number;
        editorialNotes?: EditorialNotes;
        genreNames: string[];
        isrc: string;
        movementCount?: number;
        movementName?: string;
        movementNumber?: number;
        name: string;
        playParams?: PlayParameters;
        previews: Preview[];
        releaseDate: CalendarDate;
        trackNumber: number;
        url: string;
        workName?: string;
    }
    interface Relationships {
        albums?: AlbumRelationship;
        artists?: ArtistRelationship;
        genres?: GenreRelationship;
        station?: StationRelationship;
    }
}
export {};
//# sourceMappingURL=song.d.ts.map