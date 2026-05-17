export const canRegisterServiceWorker = (
  navigatorLike: Pick<Navigator, 'serviceWorker'> | undefined
) => Boolean(navigatorLike && 'serviceWorker' in navigatorLike);

export const shouldVerifyPushSubscription = ({
  pushNotificationsEnabled,
  userId,
}: {
  pushNotificationsEnabled: boolean;
  userId: number | undefined;
}) => Boolean(userId && pushNotificationsEnabled);
