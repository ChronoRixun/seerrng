import MeshNetworkIcon from '@app/assets/mesh-network.svg';
import type { AssociationMediaType } from '@app/hooks/useAssociations';
import useAssociations, {
  toAssociationMediaType,
} from '@app/hooks/useAssociations';
import defineMessages from '@app/utils/defineMessages';
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
  hideWhenEmpty?: boolean;
}

const AssociationBadge = ({
  mediaType,
  id,
  variant = 'card',
  hideWhenEmpty = false,
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
  const { isLoading: isChecking, hasStrongEdges } = useAssociations(
    associationType,
    id,
    {
      enabled: hideWhenEmpty && !!associationType,
      includeWeak: false,
    }
  );

  if (!associationType || id == null || id === '') {
    return null;
  }

  if (hideWhenEmpty && !isChecking && !hasStrongEdges) {
    return null;
  }

  const buttonClass =
    variant === 'card'
      ? 'inline-flex h-7 w-7 items-center justify-center rounded-full border-2 border-cyan-100/95 bg-gradient-to-br from-cyan-500/95 via-teal-500/90 to-blue-500/95 text-white shadow-md shadow-cyan-950/40 ring-2 ring-black/25 backdrop-blur transition hover:border-white hover:from-cyan-400 hover:via-teal-400 hover:to-blue-400 sm:h-8 sm:w-8'
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
        disabled={hideWhenEmpty && isChecking}
        onClick={(e: React.MouseEvent) => {
          e.preventDefault();
          e.stopPropagation();
          if (hideWhenEmpty && isChecking) {
            return;
          }
          setIsOpen((open) => !open);
        }}
      >
        <MeshNetworkIcon
          className={variant === 'card' ? 'h-5 w-5 sm:h-6 sm:w-6' : 'h-4 w-4'}
          aria-hidden="true"
        />
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
