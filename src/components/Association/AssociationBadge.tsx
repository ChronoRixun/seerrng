import type { AssociationMediaType } from '@app/hooks/useAssociations';
import useAssociations, {
  toAssociationMediaType,
} from '@app/hooks/useAssociations';
import MeshNetworkIcon from '@app/assets/mesh-network.svg';
import defineMessages from '@app/utils/defineMessages';
import { useMemo, useState } from 'react';
import ReactDOM from 'react-dom';
import { useIntl } from 'react-intl';
import { usePopperTooltip } from 'react-popper-tooltip';
import AssociationPopover from './AssociationPopover';

const messages = defineMessages('components.Association', {
  associations: 'Associations',
  similar: 'Similar',
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
      ? 'flex h-4 items-center justify-center gap-1 rounded-full border border-cyan-300 bg-cyan-600/90 px-1.5 text-white shadow-md backdrop-blur transition hover:border-cyan-200 hover:bg-cyan-500/95 sm:h-5 sm:px-2'
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
          className={variant === 'card' ? 'h-3 w-3' : 'h-4 w-4'}
          aria-hidden="true"
        />
        {variant === 'card' && (
          <span className="hidden text-[0.625rem] font-medium uppercase leading-none tracking-wider sm:inline">
            {intl.formatMessage(messages.similar)}
          </span>
        )}
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
