import PersonCard from '@app/components/PersonCard';
import TitleCard from '@app/components/TitleCard';
import type { AssociationNode } from '@app/hooks/useAssociations';

const AssociationCard = ({ node }: { node: AssociationNode }) => {
  switch (node.mediaType) {
    case 'movie':
      return (
        <TitleCard
          id={node.id}
          image={node.posterPath}
          status={node.mediaInfo?.status}
          summary={node.overview}
          title={node.title}
          year={node.releaseDate}
          mediaType="movie"
        />
      );
    case 'tv':
      return (
        <TitleCard
          id={node.id}
          image={node.posterPath}
          status={node.mediaInfo?.status}
          summary={node.overview}
          title={node.name}
          year={node.firstAirDate}
          mediaType="tv"
        />
      );
    case 'album':
      return (
        <TitleCard
          id={node.id}
          image={node.posterPath}
          status={node.mediaInfo?.status}
          title={node.title}
          artist={node['artist-credit']?.[0]?.name}
          year={node['first-release-date']?.split('-')[0]}
          mediaType="album"
          needsCoverArt={node.needsCoverArt}
        />
      );
    case 'artist':
      return (
        <TitleCard
          id={node.id}
          image={node.artistThumb ?? undefined}
          title={node.name}
          mediaType="artist"
        />
      );
    case 'book':
      return (
        <TitleCard
          id={node.id}
          image={node.posterPath}
          status={node.mediaInfo?.status}
          title={node.title}
          year={node.firstPublishYear?.toString()}
          mediaType="book"
        />
      );
    case 'person':
      return (
        <PersonCard
          personId={node.id}
          name={node.name}
          profilePath={node.profilePath}
        />
      );
    default:
      return null;
  }
};

export default AssociationCard;
