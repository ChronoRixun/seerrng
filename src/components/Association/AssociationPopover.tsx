import CachedImage from '@app/components/Common/CachedImage';
import LoadingSpinner from '@app/components/Common/LoadingSpinner';
import type {
  AssociationEdge,
  AssociationMediaType,
} from '@app/hooks/useAssociations';
import useAssociations from '@app/hooks/useAssociations';
import defineMessages from '@app/utils/defineMessages';
import { ArrowsPointingOutIcon } from '@heroicons/react/24/outline';
import Link from 'next/link';
import { useIntl } from 'react-intl';
import { nodeHref, nodeImage, nodeImageType, nodeTitle } from './helpers';

const messages = defineMessages('components.Association', {
  morelikethis: 'More like this',
  alsoconnected: 'Also connected',
  explore: 'Explore the full map',
  empty: 'No associations found yet.',
});

interface AssociationPopoverProps {
  mediaType: AssociationMediaType;
  id: string | number;
}

const EdgeRow = ({ edge }: { edge: AssociationEdge }) => {
  const image = nodeImage(edge.node);
  return (
    <Link
      href={nodeHref(edge.node)}
      className="flex items-center gap-3 rounded-lg px-2 py-1.5 transition hover:bg-gray-700"
    >
      <div className="relative h-12 w-9 flex-shrink-0 overflow-hidden rounded bg-gray-800 ring-1 ring-gray-700">
        {image && (
          <CachedImage
            type={nodeImageType(edge.node)}
            src={image}
            alt=""
            fill
            style={{ objectFit: 'cover' }}
          />
        )}
      </div>
      <div className="min-w-0">
        <div className="truncate text-sm font-semibold text-white">
          {nodeTitle(edge.node)}
        </div>
        <div className="truncate text-xs text-gray-400">{edge.reason}</div>
      </div>
    </Link>
  );
};

const AssociationPopover = ({ mediaType, id }: AssociationPopoverProps) => {
  const intl = useIntl();
  const { edges, isLoading } = useAssociations(mediaType, id, {
    includeWeak: true,
  });

  const sameMedium = edges
    .filter((e) => e.type === 'similar' || e.type === 'recommended')
    .slice(0, 5);
  const connected = edges
    .filter((e) => e.type === 'shared-person' || e.type === 'shared-genre')
    .slice(0, 4);

  return (
    <div className="w-80 overflow-hidden rounded-xl border border-gray-700 bg-gray-800 shadow-2xl">
      <div className="max-h-96 overflow-y-auto p-2">
        {isLoading && (
          <div className="flex justify-center py-8">
            <LoadingSpinner />
          </div>
        )}

        {!isLoading && edges.length === 0 && (
          <div className="px-3 py-6 text-center text-sm text-gray-400">
            {intl.formatMessage(messages.empty)}
          </div>
        )}

        {sameMedium.length > 0 && (
          <div className="mb-2">
            <div className="px-2 pb-1 pt-2 text-xs font-bold uppercase tracking-wider text-gray-500">
              {intl.formatMessage(messages.morelikethis)}
            </div>
            {sameMedium.map((edge) => (
              <EdgeRow
                key={`${edge.node.mediaType}:${edge.node.id}`}
                edge={edge}
              />
            ))}
          </div>
        )}

        {connected.length > 0 && (
          <div>
            <div className="px-2 pb-1 pt-2 text-xs font-bold uppercase tracking-wider text-gray-500">
              {intl.formatMessage(messages.alsoconnected)}
            </div>
            {connected.map((edge) => (
              <EdgeRow
                key={`${edge.node.mediaType}:${edge.node.id}`}
                edge={edge}
              />
            ))}
          </div>
        )}
      </div>

      <Link
        href={`/associations/${mediaType}/${encodeURIComponent(String(id))}`}
        className="flex items-center justify-center gap-2 border-t border-gray-700 bg-gray-800 px-3 py-2.5 text-sm font-semibold text-indigo-400 transition hover:bg-gray-700 hover:text-indigo-300"
      >
        <ArrowsPointingOutIcon className="h-4 w-4" />
        {intl.formatMessage(messages.explore)}
      </Link>
    </div>
  );
};

export default AssociationPopover;
