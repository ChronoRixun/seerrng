import type { AssociationMediaType } from '@app/hooks/useAssociations';
import { toAssociationMediaType } from '@app/hooks/useAssociations';
import defineMessages from '@app/utils/defineMessages';
import { Popover, Transition } from '@headlessui/react';
import { ShareIcon } from '@heroicons/react/24/solid';
import { Fragment } from 'react';
import { useIntl } from 'react-intl';
import AssociationPopover from './AssociationPopover';

const messages = defineMessages('components.Association', {
  associations: 'Associations',
});

interface AssociationBadgeProps {
  mediaType: string;
  id: string | number;
  /** 'card' floats over poster art; 'inline' sits next to a title. */
  variant?: 'card' | 'inline';
}

const AssociationBadge = ({
  mediaType,
  id,
  variant = 'card',
}: AssociationBadgeProps) => {
  const intl = useIntl();
  const associationType: AssociationMediaType | null =
    toAssociationMediaType(mediaType);

  if (!associationType || id == null || id === '') {
    return null;
  }

  const buttonClass =
    variant === 'card'
      ? 'flex h-7 w-7 items-center justify-center rounded-full bg-gray-900/80 text-white ring-1 ring-gray-600 backdrop-blur transition hover:bg-gray-700'
      : 'flex h-8 w-8 items-center justify-center rounded-full bg-gray-800 text-gray-300 ring-1 ring-gray-700 transition hover:text-white';

  return (
    <Popover className="relative">
      <Popover.Button
        as="button"
        type="button"
        data-testid="association-badge"
        aria-label={intl.formatMessage(messages.associations)}
        title={intl.formatMessage(messages.associations)}
        className={buttonClass}
        onClick={(e: React.MouseEvent) => {
          e.preventDefault();
          e.stopPropagation();
        }}
      >
        <ShareIcon className="h-4 w-4" />
      </Popover.Button>
      <Transition
        as={Fragment}
        enter="transition ease-out duration-150"
        enterFrom="opacity-0 translate-y-1"
        enterTo="opacity-100 translate-y-0"
        leave="transition ease-in duration-100"
        leaveFrom="opacity-100 translate-y-0"
        leaveTo="opacity-0 translate-y-1"
      >
        <Popover.Panel
          className="absolute right-0 z-50 mt-2 max-w-[calc(100vw-2rem)] sm:max-w-none"
          data-testid="association-popover"
          onClick={(e: React.MouseEvent) => e.stopPropagation()}
        >
          <AssociationPopover mediaType={associationType} id={id} />
        </Popover.Panel>
      </Transition>
    </Popover>
  );
};

export default AssociationBadge;
