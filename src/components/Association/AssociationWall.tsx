import Slider from '@app/components/Slider';
import type {
  AssociationEdge,
  AssociationGraph,
} from '@app/hooks/useAssociations';
import defineMessages from '@app/utils/defineMessages';
import { useIntl } from 'react-intl';
import AssociationCard from './AssociationCard';

const messages = defineMessages('components.Association', {
  similar: 'More like this',
  recommended: 'Recommended',
  music: 'Connected music',
  screen: 'On screen',
  adjacent: 'Adjacent picks',
  books: 'Same author',
  empty: 'No associations found yet.',
});

interface Section {
  key: string;
  title: string;
  match: (edge: AssociationEdge) => boolean;
}

const AssociationWall = ({ graph }: { graph: AssociationGraph }) => {
  const intl = useIntl();

  const sections: Section[] = [
    {
      key: 'similar',
      title: intl.formatMessage(messages.similar),
      match: (e) => e.type === 'similar',
    },
    {
      key: 'recommended',
      title: intl.formatMessage(messages.recommended),
      match: (e) => e.type === 'recommended',
    },
    {
      key: 'music',
      title: intl.formatMessage(messages.music),
      match: (e) =>
        e.type === 'shared-person' &&
        (e.node.mediaType === 'artist' || e.node.mediaType === 'album'),
    },
    {
      key: 'screen',
      title: intl.formatMessage(messages.screen),
      match: (e) =>
        e.type === 'shared-person' &&
        (e.node.mediaType === 'movie' || e.node.mediaType === 'tv'),
    },
    {
      key: 'books',
      title: intl.formatMessage(messages.books),
      match: (e) => e.type === 'shared-person' && e.node.mediaType === 'book',
    },
    {
      key: 'adjacent',
      title: intl.formatMessage(messages.adjacent),
      match: (e) => e.type === 'shared-genre',
    },
  ];

  const rendered = sections
    .map((section) => ({
      section,
      edges: graph.edges.filter(section.match),
    }))
    .filter(({ edges }) => edges.length > 0);

  if (rendered.length === 0) {
    return (
      <div className="py-16 text-center text-gray-400">
        {intl.formatMessage(messages.empty)}
      </div>
    );
  }

  return (
    <div className="space-y-8" data-testid="association-wall">
      {rendered.map(({ section, edges }) => (
        <div key={section.key}>
          <div className="slider-header">
            <div className="slider-title">
              <span>{section.title}</span>
            </div>
          </div>
          <Slider
            sliderKey={`assoc-${section.key}`}
            isLoading={false}
            isEmpty={false}
            items={edges.map((edge) => (
              <AssociationCard
                key={`${edge.node.mediaType}:${edge.node.id}`}
                node={edge.node}
              />
            ))}
          />
        </div>
      ))}
    </div>
  );
};

export default AssociationWall;
