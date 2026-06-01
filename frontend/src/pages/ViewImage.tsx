import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import { BackNavBar } from '../components/NavBar';
import { useTelegramBackButton } from '../hooks/useTelegram';

export default function ViewImage() {
  const { id } = useParams();
  const { t } = useTranslation('splash');
  useTelegramBackButton(null);
  return (
    <div className="h-full flex flex-col bg-Cr-Bg-soft-v2">
      <BackNavBar />
      <div className="p-8 text-Cr-text-subtler-v2 text-center">
        {t('splash:viewerComingSoon', { id })}
      </div>
    </div>
  );
}
