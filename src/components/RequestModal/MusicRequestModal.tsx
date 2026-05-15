import Alert from '@app/components/Common/Alert';
import Modal from '@app/components/Common/Modal';
import QuotaDisplay from '@app/components/RequestModal/QuotaDisplay';
import useToasts from '@app/hooks/useToasts';
import { Permission, useUser } from '@app/hooks/useUser';
import globalMessages from '@app/i18n/globalMessages';
import defineMessages from '@app/utils/defineMessages';
import { MediaStatus, MediaType } from '@server/constants/media';
import type { MediaRequest } from '@server/entity/MediaRequest';
import type { QuotaResponse } from '@server/interfaces/api/userInterfaces';
import type { MusicDetails } from '@server/models/Music';
import axios from 'axios';
import { useCallback, useEffect, useState } from 'react';
import { useIntl } from 'react-intl';
import useSWR, { mutate } from 'swr';

const messages = defineMessages('components.RequestModal.Music', {
  requestadmin: 'This request will be approved automatically.',
  requestSuccess: '<strong>{title}</strong> requested successfully!',
  requestmusic: 'Request Music',
  requesterror: 'Something went wrong while submitting the request.',
});

interface MusicRequestModalProps {
  mbId: string;
  onCancel?: () => void;
  onComplete?: (newStatus: MediaStatus) => void;
  onUpdating?: (isUpdating: boolean) => void;
}

const MusicRequestModal = ({
  mbId,
  onCancel,
  onComplete,
  onUpdating,
}: MusicRequestModalProps) => {
  const intl = useIntl();
  const { addToast } = useToasts();
  const { user, hasPermission } = useUser();
  const [isUpdating, setIsUpdating] = useState(false);
  const { data, error } = useSWR<MusicDetails>(`/api/v1/music/${mbId}`, {
    revalidateOnMount: true,
  });
  const { data: quota } = useSWR<QuotaResponse>(
    user ? `/api/v1/user/${user.id}/quota` : null
  );

  useEffect(() => {
    onUpdating?.(isUpdating);
  }, [isUpdating, onUpdating]);

  const sendRequest = useCallback(async () => {
    setIsUpdating(true);

    try {
      const response = await axios.post<MediaRequest>('/api/v1/request', {
        mediaId: data?.mbId ?? mbId,
        mediaType: MediaType.MUSIC,
      });

      mutate('/api/v1/request?filter=all&take=10&sort=modified&skip=0');
      mutate('/api/v1/request/count');

      if (response.data) {
        onComplete?.(
          hasPermission([Permission.AUTO_APPROVE, Permission.AUTO_APPROVE_MUSIC], {
            type: 'or',
          })
            ? MediaStatus.PROCESSING
            : MediaStatus.PENDING
        );
        addToast(
          <span>
            {intl.formatMessage(messages.requestSuccess, {
              title: data?.title,
              strong: (msg: React.ReactNode) => <strong>{msg}</strong>,
            })}
          </span>,
          { appearance: 'success', autoDismiss: true }
        );
      }
    } catch {
      addToast(intl.formatMessage(messages.requesterror), {
        appearance: 'error',
        autoDismiss: true,
      });
    } finally {
      setIsUpdating(false);
    }
  }, [addToast, data?.mbId, data?.title, hasPermission, intl, mbId, onComplete]);

  const hasAutoApprove = hasPermission(
    [Permission.MANAGE_REQUESTS, Permission.AUTO_APPROVE, Permission.AUTO_APPROVE_MUSIC],
    { type: 'or' }
  );

  return (
    <Modal
      loading={(!data && !error) || !quota}
      backgroundClickable
      onCancel={onCancel}
      onOk={sendRequest}
      okDisabled={isUpdating || quota?.music?.restricted}
      title={intl.formatMessage(messages.requestmusic)}
      subTitle={data ? `${data.artist.name} - ${data.title}` : undefined}
      okText={
        isUpdating
          ? intl.formatMessage(globalMessages.requesting)
          : intl.formatMessage(globalMessages.request)
      }
      okButtonType="primary"
      backdrop={data?.artistBackdrop ?? data?.artistThumb ?? data?.posterPath}
    >
      {hasAutoApprove && !quota?.music?.restricted && (
        <div className="mt-6">
          <Alert
            title={intl.formatMessage(messages.requestadmin)}
            type="info"
          />
        </div>
      )}
      {(quota?.music?.limit ?? 0) > 0 && (
        <QuotaDisplay mediaType="music" quota={quota?.music} />
      )}
    </Modal>
  );
};

export default MusicRequestModal;
