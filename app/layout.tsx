import type { Metadata, Viewport } from 'next';
import { Be_Vietnam_Pro, Fraunces, JetBrains_Mono } from 'next/font/google';
import './globals.css';
import { LiveProvider } from '@/lib/client/live';
import { AppShell } from '@/components/shell';
import { ConfirmHost, Toaster } from '@/components/ui';
import { I18nProvider } from '@/lib/i18n/provider';
import { dictionary, requestLocale, tl } from '@/lib/i18n/server';
import { LOCALES, LOCALE_COOKIE, LOCALE_STORAGE } from '@/lib/i18n/locales';

const sans = Be_Vietnam_Pro({
  subsets: ['latin', 'vietnamese'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-sans-family',
  display: 'swap',
});

const display = Fraunces({
  subsets: ['latin', 'vietnamese'],
  style: ['normal', 'italic'],
  variable: '--font-display-family',
  display: 'swap',
});

const mono = JetBrains_Mono({
  subsets: ['latin', 'vietnamese'],
  variable: '--font-mono-family',
  display: 'swap',
});

export async function generateMetadata(): Promise<Metadata> {
  const locale = await requestLocale();
  return {
    title: { default: 'JVCompany', template: '%s · JVCompany' }, // i18n-ignore: tên sản phẩm
    description: tl(locale, 'Công ty phần mềm vận hành bởi các AI Agent chuyên môn – giao việc, phê duyệt, điều khiển máy tính.'),
  };
}

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: dark)', color: '#161412' },
    { media: '(prefers-color-scheme: light)', color: '#f3efe6' },
  ],
};

// Đặt giao diện sáng/tối và trạng thái thanh menu (mở / thu gọn) trước khi trình duyệt vẽ để tránh nháy màn hình.
const THEME_SCRIPT = `(function(){try{var c=localStorage.getItem('jv-theme')||'light';var d=c==='dark'||(c==='system'&&matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.dataset.theme=d?'dark':'light';document.documentElement.dataset.nav=localStorage.getItem('jv-nav')==='collapsed'?'collapsed':'open';}catch(e){document.documentElement.dataset.theme='light';}})();`;

// Ngôn ngữ: localStorage 'jv-lang' là lựa chọn chính; cookie 'jv_lang' để máy chủ vẽ đúng ngôn ngữ.
// Hai nơi lệch nhau (vd cookie hết hạn) → ghi lại cookie và tải lại một lần trước khi vẽ; chỉ có cookie → chép vào localStorage.
const LANG_SCRIPT = `(function(){try{var s=localStorage.getItem('${LOCALE_STORAGE}');var m=document.cookie.match(/(?:^|; )${LOCALE_COOKIE}=([^;]+)/);var c=m?m[1]:null;var ok=${JSON.stringify(LOCALES.map((l) => l.code))};if(s&&ok.indexOf(s)<0)s=null;if(s&&s!==c){document.cookie='${LOCALE_COOKIE}='+s+'; path=/; max-age=31536000; samesite=lax';if(!sessionStorage.getItem('jv-lang-sync')){sessionStorage.setItem('jv-lang-sync','1');location.reload();}}else{sessionStorage.removeItem('jv-lang-sync');if(!s&&c&&ok.indexOf(c)>=0)localStorage.setItem('${LOCALE_STORAGE}',c);}}catch(e){}})();`;

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const locale = await requestLocale();
  return (
    <html lang={locale} data-theme="light" suppressHydrationWarning className={`${sans.variable} ${display.variable} ${mono.variable}`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT + LANG_SCRIPT }} />
      </head>
      <body>
        <I18nProvider locale={locale} dict={dictionary(locale)}>
          <LiveProvider>
            <AppShell>{children}</AppShell>
            <Toaster />
            <ConfirmHost />
          </LiveProvider>
        </I18nProvider>
      </body>
    </html>
  );
}
