import type { UserSettings } from '@app/hooks/useUser';
import { useUser } from '@app/hooks/useUser';
import type {
  CardTextVisibility,
  UserSettingsCardTextResponse,
} from '@server/interfaces/api/userSettingsInterfaces';
import axios from 'axios';
import { useCallback, useEffect, useMemo, useState } from 'react';
import useSWR from 'swr';

type CardTextMediaType = keyof UserSettingsCardTextResponse;

const storageKey = 'seerr.cardTextVisibility';

const defaultCardTextVisibility: Required<UserSettingsCardTextResponse> = {
  movie: 'hover',
  tv: 'hover',
  album: 'always',
  book: 'always',
};

const isCardTextVisibility = (value: unknown): value is CardTextVisibility =>
  value === 'always' || value === 'hover';

const readStoredVisibility = (): UserSettingsCardTextResponse => {
  if (typeof window === 'undefined') {
    return {};
  }

  try {
    const parsed = JSON.parse(
      window.localStorage.getItem(storageKey) ?? '{}'
    ) as Record<string, unknown>;

    return {
      movie: isCardTextVisibility(parsed.movie) ? parsed.movie : undefined,
      tv: isCardTextVisibility(parsed.tv) ? parsed.tv : undefined,
      album: isCardTextVisibility(parsed.album) ? parsed.album : undefined,
      book: isCardTextVisibility(parsed.book) ? parsed.book : undefined,
    };
  } catch {
    return {};
  }
};

const writeStoredVisibility = (
  visibility: UserSettingsCardTextResponse
): void => {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    window.localStorage.setItem(storageKey, JSON.stringify(visibility));
  } catch {
    // Local storage is a convenience fallback; server persistence still applies.
  }
};

const fromUserSettings = (
  settings?: UserSettings
): UserSettingsCardTextResponse => ({
  movie:
    settings?.cardTextVisibility?.movie ?? settings?.cardTextVisibilityMovie,
  tv: settings?.cardTextVisibility?.tv ?? settings?.cardTextVisibilityTv,
  album:
    settings?.cardTextVisibility?.album ?? settings?.cardTextVisibilityAlbum,
  book: settings?.cardTextVisibility?.book ?? settings?.cardTextVisibilityBook,
});

const useCardTextVisibility = () => {
  const { user, revalidate: revalidateUser } = useUser();
  const [localVisibility, setLocalVisibility] =
    useState<UserSettingsCardTextResponse>({});
  const endpoint = user?.id
    ? `/api/v1/user/${user.id}/settings/card-text`
    : null;
  const { data, mutate } = useSWR<UserSettingsCardTextResponse>(endpoint, {
    fallbackData: fromUserSettings(user?.settings),
    revalidateOnFocus: false,
  });

  useEffect(() => {
    setLocalVisibility(readStoredVisibility());
  }, []);

  const visibility = useMemo(
    () => ({
      ...defaultCardTextVisibility,
      ...localVisibility,
      ...fromUserSettings(user?.settings),
      ...data,
    }),
    [data, localVisibility, user?.settings]
  );

  const setVisibility = useCallback(
    async (
      mediaType: CardTextMediaType,
      nextVisibility: CardTextVisibility
    ): Promise<void> => {
      const previousLocalVisibility = localVisibility;
      const nextValue = {
        ...visibility,
        [mediaType]: nextVisibility,
      };

      setLocalVisibility(nextValue);
      writeStoredVisibility(nextValue);

      if (!endpoint) {
        return;
      }

      try {
        await mutate(
          async () => {
            const response = await axios.post<UserSettingsCardTextResponse>(
              endpoint,
              {
                [mediaType]: nextVisibility,
              }
            );
            await revalidateUser();

            return response.data;
          },
          {
            optimisticData: nextValue,
            rollbackOnError: true,
            revalidate: false,
          }
        );
      } catch (e) {
        setLocalVisibility(previousLocalVisibility);
        writeStoredVisibility(previousLocalVisibility);
        throw e;
      }
    },
    [endpoint, localVisibility, mutate, revalidateUser, visibility]
  );

  const toggleVisibility = useCallback(
    async (mediaType: CardTextMediaType): Promise<void> => {
      await setVisibility(
        mediaType,
        visibility[mediaType] === 'always' ? 'hover' : 'always'
      );
    },
    [setVisibility, visibility]
  );

  return {
    visibility,
    setVisibility,
    toggleVisibility,
  };
};

export default useCardTextVisibility;
