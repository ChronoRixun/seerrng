import Modal from '@app/components/Common/Modal';
import globalMessages from '@app/i18n/globalMessages';
import defineMessages from '@app/utils/defineMessages';
import { Transition } from '@headlessui/react';
import { useIntl } from 'react-intl';

interface ExternalBlocklistModalProps {
  show: boolean;
  title: string;
  type: 'book' | 'music';
  backdrop?: string | null;
  onComplete?: () => void;
  onCancel?: () => void;
  isUpdating?: boolean;
}

const messages = defineMessages('component.ExternalBlocklistModal', {
  blocklisting: 'Blocklisting',
  book: 'Book',
  music: 'Music',
});

const ExternalBlocklistModal = ({
  show,
  title,
  type,
  backdrop,
  onComplete,
  onCancel,
  isUpdating,
}: ExternalBlocklistModalProps) => {
  const intl = useIntl();

  return (
    <Transition
      as="div"
      enter="transition-opacity duration-300"
      enterFrom="opacity-0"
      enterTo="opacity-100"
      leave="transition-opacity duration-300"
      leaveFrom="opacity-100"
      leaveTo="opacity-0"
      show={show}
    >
      <Modal
        backgroundClickable
        title={`${intl.formatMessage(globalMessages.blocklist)} ${intl.formatMessage(
          type === 'book' ? messages.book : messages.music
        )}`}
        subTitle={title}
        onCancel={onCancel}
        onOk={onComplete}
        okText={
          isUpdating
            ? intl.formatMessage(messages.blocklisting)
            : intl.formatMessage(globalMessages.blocklist)
        }
        okButtonType="danger"
        okDisabled={isUpdating}
        backdrop={backdrop ?? undefined}
      />
    </Transition>
  );
};

export default ExternalBlocklistModal;
