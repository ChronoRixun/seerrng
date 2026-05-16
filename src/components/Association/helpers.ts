import type { AssociationNode } from '@app/hooks/useAssociations';

export const nodeHref = (node: AssociationNode): string => {
  switch (node.mediaType) {
    case 'movie':
      return `/movie/${node.id}`;
    case 'tv':
      return `/tv/${node.id}`;
    case 'album':
      return `/music/${node.id}`;
    case 'artist':
      return `/artist/${node.id}`;
    case 'person':
      return `/person/${node.id}`;
    default:
      return '/';
  }
};

export const nodeTitle = (node: AssociationNode): string => {
  switch (node.mediaType) {
    case 'movie':
      return node.title;
    case 'tv':
      return node.name;
    case 'album':
      return node.title;
    case 'artist':
    case 'person':
      return node.name;
    default:
      return '';
  }
};

export const nodeImage = (node: AssociationNode): string | undefined => {
  switch (node.mediaType) {
    case 'movie':
    case 'tv':
      return node.posterPath
        ? `https://image.tmdb.org/t/p/w300_and_h450_face${node.posterPath}`
        : undefined;
    case 'album':
      return node.posterPath ?? undefined;
    case 'artist':
      return node.artistThumb ?? undefined;
    case 'person':
      return node.profilePath
        ? `https://image.tmdb.org/t/p/w300_and_h450_face${node.profilePath}`
        : undefined;
    default:
      return undefined;
  }
};

export const nodeImageType = (
  node: AssociationNode
): 'tmdb' | 'music' => {
  switch (node.mediaType) {
    case 'album':
    case 'artist':
      return 'music';
    default:
      return 'tmdb';
  }
};
