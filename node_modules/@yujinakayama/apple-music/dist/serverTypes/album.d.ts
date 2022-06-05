import { CalendarDate } from '../calendarDate';
import { Resource } from './resource';
import { Artwork } from './artwork';
import { ContentRating } from './contentRating';
import { EditorialNotes } from './editorialNotes';
import { PlayParameters } from './playParameters';
import { ArtistRelationship } from './artistRelationship';
import { GenreRelationship } from './genreRelationship';
import { TrackRelationship } from './trackRelationship';
export interface Album extends Resource {
    attributes?: Album.Attributes;
    relationships?: Album.Relationships;
    type: 'albums';
}
declare namespace Album {
    interface Attributes {
        albumName: string;
        artistName: string;
        artwork?: Artwork;
        contentRating?: ContentRating;
        copyright?: string;
        editorialNotes?: EditorialNotes;
        genreNames: string[];
        isComplete: boolean;
        isSingle: boolean;
        name: string;
        playParams?: PlayParameters;
        recordLabel: string;
        releaseDate: CalendarDate;
        trackCount: number;
        url: string;
        isMasteredForItunes: boolean;
    }
    interface Relationships {
        artists?: ArtistRelationship;
        genres?: GenreRelationship;
        tracks?: TrackRelationship;
    }
}
export {};
//# sourceMappingURL=album.d.ts.map