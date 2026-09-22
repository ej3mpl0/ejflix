# ejFlix para Android e iOS (Expo)

Port de la app de escritorio a Android e iOS con Expo SDK 57 / React Native, un solo código. Misma interfaz (estilo Nuvio, 12 temas, AMOLED), mismas funciones: Jellyfin, addons Stremio, Live TV (M3U, Xtream, EPG), skip intro, perfiles locales con PIN y actualizaciones por APK desde GitHub Releases (en iOS, solo el aviso). En iOS 26 las superficies de cristal (cabecera, barra de pestañas flotante, hojas, controles del reproductor) usan el Liquid Glass del sistema (`expo-glass-effect`); en iOS anteriores y en Android, el desenfoque de `expo-blur`.

## Requisitos

- Node 20+ (`npm`).
- Android SDK (Android Studio) con `platform-tools`, `build-tools` y un AVD o un móvil con depuración USB.
- **JDK 17** para Gradle. El JBR de Android Studio (Java 25) hace fallar la configuración de CMake de React Native ("A restricted method in java.lang.System has been called"). Gradle suele aprovisionar uno en `%USERPROFILE%\.gradle\jdks\eclipse_adoptium-17-*`; si no, instala Temurin 17.

Variables de entorno (PowerShell):

```powershell
$env:JAVA_HOME = "$env:USERPROFILE\.gradle\jdks\eclipse_adoptium-17-amd64-windows.2"
$env:ANDROID_HOME = "$env:LOCALAPPDATA\Android\Sdk"
```

## Desarrollo

```powershell
cd mobile
npm install
npx expo prebuild --platform android   # genera android/ (ignorado en git)
npx expo run:android                   # compila el dev client y lo instala en el emulador/móvil
npx expo start                         # Metro con recarga en caliente
```

Comprobaciones: `npm run typecheck` (tsc), `npm test` (vitest: parsers M3U/XMLTV/Xtream, settings, perfiles, PlaybackInfo, segmentos, pistas).

## APK de release

1. Crea una keystore una sola vez y guárdala fuera del repo (`*.jks` y `keystore.properties` están en `.gitignore`):
   `keytool -genkeypair -v -keystore ejflix-release.jks -alias ejflix -keyalg RSA -keysize 2048 -validity 10000`
2. `mobile/keystore.properties`:
   ```
   storeFile=C:/ruta/ejflix-release.jks
   storePassword=...
   keyAlias=ejflix
   keyPassword=...
   ```
3. Sube `version` y `android.versionCode` en `app.json`, ejecuta `npx expo prebuild --platform android` y luego `npm run build:apk`. El APK queda en `android/app/build/outputs/apk/release/` y se adjunta a la release de GitHub como `ejFlix-<version>-android.apk` (la app busca assets `.apk`, preferiblemente `arm64`).

Las actualizaciones in-app solo se instalan si el APK está firmado con la misma keystore y tiene un `versionCode` mayor; Android pide una vez el permiso «instalar apps desconocidas».

## IPA de iOS

No hace falta un Mac ni una cuenta de desarrollador de pago: el workflow `.github/workflows/ios.yml` compila en un runner macOS de GitHub (Xcode 26) un `.ipa` **sin firmar**.

- Al subir una etiqueta `v*` el IPA se adjunta a esa release como `ejFlix-<version>-ios.ipa`. A mano: `gh workflow run ios.yml` y se descarga del artifact `ejflix-ios-ipa`.
- El job `simulator` arranca la app en un iPhone con iOS 26 y guarda capturas y el log en el artifact `ejflix-ios-simulator`.
- **Source de AltStore/SideStore**: cada release lleva `altstore-source.json`, generado por `scripts/altstore_source.py` a partir del propio IPA (versión, build, tamaño, permisos). Se añade en AltStore › Sources › + con `https://github.com/ej3mpl0/ejflix/releases/latest/download/altstore-source.json`; las versiones nuevas aparecen como actualización.
- Instalación: **AltStore**, **SideStore** o **Sideloadly** firman el IPA con tu Apple ID gratuito. Con un ID gratuito la firma caduca a los 7 días (AltStore/SideStore la renuevan solos) y hay un límite de 3 apps instaladas así.
- La primera vez iOS pide permiso de **red local** para llegar al servidor Jellyfin de casa: hay que aceptarlo.
- Actualizaciones: la app avisa cuando la última release trae un `.ipa` y abre GitHub; se instala igual que la primera vez.

Para un Mac propio: `npm run prebuild:ios` y abrir `ios/ejFlix.xcworkspace` en Xcode 26.

## Limitaciones conocidas

En iOS (AVPlayer):

- Solo reproduce directamente MP4/MOV (H.264/HEVC, audio AAC/AC3/EAC3/ALAC/FLAC). Con Jellyfin, todo lo demás (MKV, WebM, DTS, TrueHD) llega remuxado o transcodificado a HLS (fMP4); los subtítulos que no son WebVTT se queman en el vídeo.
- Canales Xtream siempre en HLS (`.m3u8`); un canal M3U que sea MPEG-TS crudo no se reproduce. En esos casos y en fuentes de addons que no abre, se ofrece VLC, Infuse u Outplayer si están instalados.
- Imagen en imagen al salir de la app durante la reproducción.

En Android:

- Motor de vídeo ExoPlayer (expo-video): sin AC3/EAC3/DTS/TrueHD en directo. Con Jellyfin el servidor transcodifica el audio (vídeo copiado); en fuentes de addons se ofrece abrir el enlace en un reproductor externo (VLC, mpv-android).
- HTTPS con certificado autofirmado no funciona; `http://` en la LAN sí.
- Torrents (`infoHash`) y `externalUrl` no se reproducen. Sin Discord Rich Presence.
- Guías EPG limitadas a 100 MiB descargados y una ventana de −6 h / +2 días; listas M3U a 32 MiB / 60 000 canales.
