import { DbAwareColumn } from '@server/utils/DbColumnHelper';
import {
  Column,
  Entity,
  Index,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import Media from './Media';

export enum MediaIdentifierProvider {
  TMDB = 'tmdb',
  TVDB = 'tvdb',
  IMDB = 'imdb',
  MUSICBRAINZ = 'musicbrainz',
  LISTENBRAINZ = 'listenbrainz',
  HARDCOVER = 'hardcover',
  OPENLIBRARY = 'openlibrary',
  OPENLIBRARY_EDITION = 'openlibrary_edition',
  ISBN = 'isbn',
  READARR = 'readarr',
  LIDARR = 'lidarr',
  BOOKSHELF = 'bookshelf',
  AUDIOBOOKSHELF = 'audiobookshelf',
}

@Entity()
@Unique('UNIQUE_MEDIA_IDENTIFIER', ['media', 'provider', 'value'])
@Index(['provider', 'value'])
class MediaIdentifier {
  @PrimaryGeneratedColumn()
  public id: number;

  @ManyToOne(() => Media, (media) => media.identifiers, {
    onDelete: 'CASCADE',
  })
  @Index()
  public media: Media;

  @Column({ type: 'varchar' })
  public provider: MediaIdentifierProvider;

  @Column({ type: 'varchar' })
  public value: string;

  @Column({ type: 'boolean', default: false })
  public canonical: boolean;

  @DbAwareColumn({ type: 'datetime', default: () => 'CURRENT_TIMESTAMP' })
  public createdAt: Date;

  constructor(init?: Partial<MediaIdentifier>) {
    Object.assign(this, init);
  }
}

export default MediaIdentifier;
