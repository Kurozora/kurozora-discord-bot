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
export interface MusicVideo extends Resource {
    attributes?: MusicVideo.Attributes;
    relationships?: MusicVideo.Relationships;
    type: 'musicVideos';
}
declare namespace MusicVideo {
    interface Attributes {
        albumName?: string;
        artistName: string;
        artwork: Artwork;
        contentRating?: ContentRating;
        durationInMillis?: number;
        editorialNotes?: EditorialNotes;
        genreNames: string[];
        isrc: string;
        name: string;
        playParams?: PlayParameters;
        previews: Preview[];
        releaseDate: CalendarDate;
        trackNumber?: number;
        url: string;
        videoSubType?: string;
        hasHDR: boolean;
        has4K: boolean;
    }
    interface Relationships {
        albums?: AlbumRelationship;
        artists?: ArtistRelationship;
        genres?: GenreRelationship;
    }
}
export {};
//# sourceMappingURL=musicVideo.d.ts.map