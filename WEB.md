# Веб-версия Tosto (Netlify)

1. Зарегистрируйся на netlify.com (бесплатно) → Add new site → Deploy manually → перетащи любую папку, чтобы создать пустой сайт.
2. Site configuration → Site ID: скопируй. User settings → Applications → Personal access tokens → New: скопируй токен.
3. GitHub → Settings → Secrets and variables → Actions: добавь `NETLIFY_AUTH_TOKEN` (токен) и `NETLIFY_SITE_ID` (Site ID).
4. Actions → Deploy Web (Netlify) → Run workflow. Дальше сайт обновляется сам при каждом push в `main`.
5. Supabase → Authentication → URL Configuration: добавь адрес сайта (`https://название.netlify.app/**`) в Redirect URLs.
6. В Chrome/Edge значок установки в адресной строке ставит Tosto отдельным окном.
