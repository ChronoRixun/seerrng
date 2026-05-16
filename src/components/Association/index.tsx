import Button from '@app/components/Common/Button';
import LoadingSpinner from '@app/components/Common/LoadingSpinner';
import PageTitle from '@app/components/Common/PageTitle';
import type { AssociationMediaType } from '@app/hooks/useAssociations';
import useAssociations from '@app/hooks/useAssociations';
import defineMessages from '@app/utils/defineMessages';
import { ListBulletIcon, ShareIcon } from '@heroicons/react/24/solid';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/router';
import { useEffect, useState } from 'react';
import { useIntl } from 'react-intl';
import AssociationWall from './AssociationWall';

const AssociationGraph = dynamic(() => import('./AssociationGraph'), {
  ssr: false,
  loading: () => <LoadingSpinner />,
});

const messages = defineMessages('components.Association', {
  title: 'Associations for {title}',
  wallview: 'List',
  graphview: 'Map',
  loaderror: 'Could not load associations.',
});

type ViewMode = 'wall' | 'graph';
const STORAGE_KEY = 'association-view-mode';

const AssociationExplorer = () => {
  const intl = useIntl();
  const router = useRouter();
  const mediaType = router.query.mediaType as AssociationMediaType;
  const id = router.query.id as string;

  const [view, setView] = useState<ViewMode>('wall');

  useEffect(() => {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === 'graph' || stored === 'wall') {
      setView(stored);
    }
  }, []);

  const setMode = (mode: ViewMode) => {
    setView(mode);
    window.localStorage.setItem(STORAGE_KEY, mode);
  };

  const { graph, isLoading, isError } = useAssociations(mediaType, id, {
    includeWeak: true,
  });

  if (isLoading) {
    return <LoadingSpinner />;
  }

  if (isError || !graph) {
    return (
      <div className="py-16 text-center text-gray-400">
        {intl.formatMessage(messages.loaderror)}
      </div>
    );
  }

  return (
    <>
      <PageTitle
        title={intl.formatMessage(messages.title, {
          title: graph.root.title,
        })}
      />
      <div className="mb-6 mt-2 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-white">
          {intl.formatMessage(messages.title, { title: graph.root.title })}
        </h1>
        <div className="flex gap-2">
          <Button
            buttonType={view === 'wall' ? 'primary' : 'default'}
            buttonSize="sm"
            onClick={() => setMode('wall')}
          >
            <ListBulletIcon />
            <span>{intl.formatMessage(messages.wallview)}</span>
          </Button>
          <Button
            buttonType={view === 'graph' ? 'primary' : 'default'}
            buttonSize="sm"
            onClick={() => setMode('graph')}
          >
            <ShareIcon />
            <span>{intl.formatMessage(messages.graphview)}</span>
          </Button>
        </div>
      </div>

      {view === 'wall' ? (
        <AssociationWall graph={graph} />
      ) : (
        <AssociationGraph graph={graph} />
      )}
    </>
  );
};

export default AssociationExplorer;
