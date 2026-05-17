import Button from '@app/components/Common/Button';
import Modal from '@app/components/Common/Modal';
import { getIssueOptionsForMediaType } from '@app/components/IssueModal/constants';
import useSettings from '@app/hooks/useSettings';
import useToasts from '@app/hooks/useToasts';
import { Permission, useUser } from '@app/hooks/useUser';
import globalMessages from '@app/i18n/globalMessages';
import defineMessages from '@app/utils/defineMessages';
import { RadioGroup } from '@headlessui/react';
import { ArrowRightCircleIcon } from '@heroicons/react/24/solid';
import { MAX_ISSUE_MESSAGE_LENGTH } from '@server/constants/issue';
import { MediaStatus } from '@server/constants/media';
import type Issue from '@server/entity/Issue';
import type { BookDetails } from '@server/models/Book';
import type { MovieDetails } from '@server/models/Movie';
import type { MusicDetails } from '@server/models/Music';
import type { TvDetails } from '@server/models/Tv';
import axios from 'axios';
import { Field, Formik } from 'formik';
import Link from 'next/link';
import { useIntl } from 'react-intl';
import useSWR, { mutate } from 'swr';
import * as Yup from 'yup';

const messages = defineMessages('components.IssueModal.CreateIssueModal', {
  validationMessageRequired: 'You must provide a description',
  validationMessageLength:
    'Description must be {maxLength, number} characters or fewer',
  whatswrong: "What's wrong?",
  providedetail:
    'Please provide a detailed explanation of the issue you encountered.',
  extras: 'Extras',
  season: 'Season {seasonNumber}',
  episode: 'Episode {episodeNumber}',
  allseasons: 'All Seasons',
  allepisodes: 'All Episodes',
  problemseason: 'Affected Season',
  problemepisode: 'Affected Episode',
  toastSuccessCreate:
    'Issue report for <strong>{title}</strong> submitted successfully!',
  toastFailedCreate: 'Something went wrong while submitting the issue.',
  toastviewissue: 'View Issue',
  reportissue: 'Report an Issue',
  submitissue: 'Submit Issue',
});

type IssueMediaDetails = MovieDetails | TvDetails | MusicDetails | BookDetails;

const isMusic = (media: IssueMediaDetails): media is MusicDetails => {
  return (media as MusicDetails).mediaType === 'album';
};

const isBook = (media: IssueMediaDetails): media is BookDetails => {
  return (media as BookDetails).mediaType === 'book';
};

const isMovie = (movie: IssueMediaDetails): movie is MovieDetails => {
  if (isMusic(movie) || isBook(movie)) {
    return false;
  }

  return (movie as MovieDetails).title !== undefined;
};

const classNames = (...classes: string[]) => {
  return classes.filter(Boolean).join(' ');
};

interface CreateIssueModalProps {
  mediaType: 'movie' | 'tv' | 'music' | 'book';
  tmdbId?: number;
  mediaId?: number;
  title?: string;
  backdrop?: string;
  onCancel?: () => void;
}

const CreateIssueModal = ({
  onCancel,
  mediaType,
  tmdbId,
  mediaId,
  title,
  backdrop,
}: CreateIssueModalProps) => {
  const intl = useIntl();
  const settings = useSettings();
  const { hasPermission } = useUser();
  const { addToast } = useToasts();
  const detailUrl =
    mediaType === 'movie' || mediaType === 'tv'
      ? tmdbId
        ? `/api/v1/${mediaType}/${tmdbId}`
        : null
      : null;
  const { data, error } = useSWR<IssueMediaDetails>(detailUrl);

  if (!tmdbId && !mediaId) {
    return null;
  }

  const resolvedMediaId = mediaId ?? data?.mediaInfo?.id;
  const resolvedTitle =
    title ??
    (data
      ? isMovie(data) || isMusic(data) || isBook(data)
        ? data.title
        : data.name
      : undefined);
  const issueOptions = getIssueOptionsForMediaType(mediaType);

  const availableSeasons = (data?.mediaInfo?.seasons ?? [])
    .filter(
      (season) =>
        season.status === MediaStatus.AVAILABLE ||
        season.status === MediaStatus.PARTIALLY_AVAILABLE ||
        (settings.currentSettings.series4kEnabled &&
          hasPermission([Permission.REQUEST_4K, Permission.REQUEST_4K_TV], {
            type: 'or',
          }) &&
          (season.status4k === MediaStatus.AVAILABLE ||
            season.status4k === MediaStatus.PARTIALLY_AVAILABLE))
    )
    .map((season) => season.seasonNumber);

  const CreateIssueModalSchema = Yup.object().shape({
    message: Yup.string()
      .max(
        MAX_ISSUE_MESSAGE_LENGTH,
        intl.formatMessage(messages.validationMessageLength, {
          maxLength: MAX_ISSUE_MESSAGE_LENGTH,
        })
      )
      .required(intl.formatMessage(messages.validationMessageRequired)),
  });

  return (
    <Formik
      initialValues={{
        selectedIssue: issueOptions[0],
        message: '',
        problemSeason: availableSeasons.length === 1 ? availableSeasons[0] : 0,
        problemEpisode: 0,
      }}
      validationSchema={CreateIssueModalSchema}
      onSubmit={async (values) => {
        try {
          const newIssue = await axios.post<Issue>('/api/v1/issue', {
            issueType: values.selectedIssue.issueType,
            message: values.message,
            mediaId: resolvedMediaId,
            problemSeason: values.problemSeason,
            problemEpisode:
              values.problemSeason > 0 ? values.problemEpisode : 0,
          });

          if (resolvedTitle) {
            addToast(
              <>
                <div>
                  {intl.formatMessage(messages.toastSuccessCreate, {
                    title: resolvedTitle,
                    strong: (msg: React.ReactNode) => <strong>{msg}</strong>,
                  })}
                </div>
                <Link href={`/issues/${newIssue.data.id}`} legacyBehavior>
                  <Button as="a" className="mt-4">
                    <span>{intl.formatMessage(messages.toastviewissue)}</span>
                    <ArrowRightCircleIcon />
                  </Button>
                </Link>
              </>,
              {
                appearance: 'success',
                autoDismiss: true,
              }
            );

            mutate('/api/v1/issue/count');
          }

          if (onCancel) {
            onCancel();
          }
        } catch {
          addToast(intl.formatMessage(messages.toastFailedCreate), {
            appearance: 'error',
            autoDismiss: true,
          });
        }
      }}
    >
      {({ handleSubmit, values, setFieldValue, errors, touched }) => {
        return (
          <Modal
            backgroundClickable
            onCancel={onCancel}
            title={intl.formatMessage(messages.reportissue)}
            subTitle={resolvedTitle}
            cancelText={intl.formatMessage(globalMessages.close)}
            onOk={() => handleSubmit()}
            okText={intl.formatMessage(messages.submitissue)}
            loading={!!detailUrl && !data && !error}
            backdrop={
              backdrop ??
              (!data || isMusic(data) || isBook(data) || !data.backdropPath
                ? undefined
                : `https://image.tmdb.org/t/p/w1920_and_h800_multi_faces/${data.backdropPath}`)
            }
          >
            {mediaType === 'tv' &&
              data &&
              !isMovie(data) &&
              !isMusic(data) &&
              !isBook(data) && (
                <>
                  <div className="form-row">
                    <label htmlFor="problemSeason" className="text-label">
                      {intl.formatMessage(messages.problemseason)}
                      <span className="label-required">*</span>
                    </label>
                    <div className="form-input-area">
                      <div className="form-input-field">
                        <Field
                          as="select"
                          id="problemSeason"
                          name="problemSeason"
                          disabled={availableSeasons.length === 1}
                        >
                          {availableSeasons.length > 1 && (
                            <option value={0}>
                              {intl.formatMessage(messages.allseasons)}
                            </option>
                          )}
                          {availableSeasons.map((season) => (
                            <option
                              value={season}
                              key={`problem-season-${season}`}
                            >
                              {season === 0
                                ? intl.formatMessage(messages.extras)
                                : intl.formatMessage(messages.season, {
                                    seasonNumber: season,
                                  })}
                            </option>
                          ))}
                        </Field>
                      </div>
                    </div>
                  </div>
                  {values.problemSeason > 0 && (
                    <div className="form-row mb-2">
                      <label htmlFor="problemEpisode" className="text-label">
                        {intl.formatMessage(messages.problemepisode)}
                        <span className="label-required">*</span>
                      </label>
                      <div className="form-input-area">
                        <div className="form-input-field">
                          <Field
                            as="select"
                            id="problemEpisode"
                            name="problemEpisode"
                          >
                            <option value={0}>
                              {intl.formatMessage(messages.allepisodes)}
                            </option>
                            {[
                              ...Array(
                                data.seasons.find(
                                  (season) =>
                                    Number(values.problemSeason) ===
                                    season.seasonNumber
                                )?.episodeCount ?? 0
                              ),
                            ].map((i, index) => (
                              <option
                                value={index + 1}
                                key={`problem-episode-${index + 1}`}
                              >
                                {intl.formatMessage(messages.episode, {
                                  episodeNumber: index + 1,
                                })}
                              </option>
                            ))}
                          </Field>
                        </div>
                      </div>
                    </div>
                  )}
                </>
              )}
            <RadioGroup
              value={values.selectedIssue}
              onChange={(issue) => setFieldValue('selectedIssue', issue)}
              className="mt-4"
            >
              <RadioGroup.Label className="sr-only">
                Select an Issue
              </RadioGroup.Label>
              <div className="-space-y-px overflow-hidden rounded-md bg-gray-800/30">
                {issueOptions.map((setting, index) => (
                  <RadioGroup.Option
                    key={`issue-type-${setting.issueType}`}
                    value={setting}
                    className={({ checked }) =>
                      classNames(
                        index === 0 ? 'rounded-tl-md rounded-tr-md' : '',
                        index === issueOptions.length - 1
                          ? 'rounded-bl-md rounded-br-md'
                          : '',
                        checked
                          ? 'z-10 border border-indigo-500 bg-indigo-400/20'
                          : 'border-gray-500',
                        'relative flex cursor-pointer border p-4 focus:outline-none'
                      )
                    }
                  >
                    {({ active, checked }) => (
                      <>
                        <span
                          className={`${
                            checked
                              ? 'border-transparent bg-indigo-600'
                              : 'border-gray-300 bg-white'
                          } ${
                            active ? 'ring-2 ring-indigo-300 ring-offset-2' : ''
                          } mt-0.5 flex h-4 w-4 cursor-pointer items-center justify-center rounded-full border`}
                          aria-hidden="true"
                        >
                          <span className="h-1.5 w-1.5 rounded-full bg-white" />
                        </span>
                        <div className="ml-3 flex flex-col">
                          <RadioGroup.Label
                            as="span"
                            className={`block text-sm font-medium ${
                              checked ? 'text-indigo-100' : 'text-gray-100'
                            }`}
                          >
                            {intl.formatMessage(setting.name)}
                          </RadioGroup.Label>
                        </div>
                      </>
                    )}
                  </RadioGroup.Option>
                ))}
              </div>
            </RadioGroup>
            <div className="mt-4 flex-col space-y-2">
              <label htmlFor="message">
                {intl.formatMessage(messages.whatswrong)}
                <span className="label-required">*</span>
              </label>
              <Field
                as="textarea"
                name="message"
                id="message"
                className="h-28"
                placeholder={intl.formatMessage(messages.providedetail)}
              />
              {errors.message &&
                touched.message &&
                typeof errors.message === 'string' && (
                  <div className="error">{errors.message}</div>
                )}
            </div>
          </Modal>
        );
      }}
    </Formik>
  );
};

export default CreateIssueModal;
