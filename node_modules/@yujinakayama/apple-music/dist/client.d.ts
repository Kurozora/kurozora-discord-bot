import { ClientConfiguration } from './clientConfiguration';
import { ResourceClient } from './resourceClient';
import { AlbumResponse } from './serverTypes/albumResponse';
import { ArtistResponse } from './serverTypes/artistResponse';
import { MusicVideoResponse } from './serverTypes/musicVideoResponse';
import { PlaylistResponse } from './serverTypes/playlistResponse';
import { SongResponse } from './serverTypes/songResponse';
import { StationResponse } from './serverTypes/stationResponse';
export declare class Client {
    configuration: ClientConfiguration;
    albums: ResourceClient<AlbumResponse>;
    artists: ResourceClient<ArtistResponse>;
    musicVideos: ResourceClient<MusicVideoResponse>;
    playlists: ResourceClient<PlaylistResponse>;
    songs: ResourceClient<SongResponse>;
    stations: ResourceClient<StationResponse>;
    constructor(configuration: ClientConfiguration);
}
//# sourceMappingURL=client.d.ts.map