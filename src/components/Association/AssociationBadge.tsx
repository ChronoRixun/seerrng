import type { AssociationMediaType } from '@app/hooks/useAssociations';
import { toAssociationMediaType } from '@app/hooks/useAssociations';
import defineMessages from '@app/utils/defineMessages';
import { ShareIcon } from '@heroicons/react/24/solid';
import { useMemo, useState } from 'react';
import ReactDOM from 'react-dom';
import { useIntl } from 'react-intl';
import { usePopperTooltip } from 'react-popper-tooltip';
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
  const [isOpen, setIsOpen] = useState(false);
  const associationType: AssociationMediaType | null =
    toAssociationMediaType(mediaType);
  const popperConfig = useMemo(
    () => ({
      interactive: true,
      offset: [0, 8] as [number, number],
      placement: 'auto-end' as const,
      trigger: 'click' as const,
      visible: isOpen,
      onVisibleChange: setIsOpen,
    }),
    [isOpen]
  );
  const { getTooltipProps, setTooltipRef, setTriggerRef } =
    usePopperTooltip(popperConfig);

  if (!associationType || id == null || id === '') {
    return null;
  }

  const buttonClass =
    variant === 'card'
      ? 'flex h-7 w-7 items-center justify-center rounded-full bg-gray-900/80 text-white ring-1 ring-gray-600 backdrop-blur transition hover:bg-gray-700'
      : 'flex h-8 w-8 items-center justify-center rounded-full bg-gray-800 text-gray-300 ring-1 ring-gray-700 transition hover:text-white';

  return (
    <>
      <button
        ref={setTriggerRef}
        type="button"
        data-testid="association-badge"
        aria-label={intl.formatMessage(messages.associations)}
        title={intl.formatMessage(messages.associations)}
        className={buttonClass}
        onClick={(e: React.MouseEvent) => {
          e.preventDefault();
          e.stopPropagation();
          setIsOpen((open) => !open);
        }}
      >
        <ShareIcon className="h-4 w-4" />
      </button>
      {isOpen &&
        ReactDOM.createPortal(
          <div
            ref={setTooltipRef}
            {...getTooltipProps({
              className: 'z-50 max-w-[calc(100vw-2rem)] sm:max-w-none',
            })}
            data-testid="association-popover"
            role="dialog"
            aria-label={intl.formatMessage(messages.associations)}
          >
            <AssociationPopover mediaType={associationType} id={id} />
          </div>,
          document.body
        )}
    </>
  );
};

export default AssociationBadge;
