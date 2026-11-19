# TornCrimeHelper

Userscript d'aide aux crimes de Torn, chargé seulement sur les pages de crimes (le hub et chaque crime). Fonctionne dans un gestionnaire de userscripts de navigateur (Violentmonkey, Tampermonkey) et dans Torn PDA.

## Fonctions

### Bootlegging : genre de DVD à copier

Sur la page Bootlegging, un bloc au-dessus des crimes (même style que Torn Oracle) affiche, par genre, la **cible** (nombre de DVD visé) et l'**écart** du stock à cette cible. Le stock d'un genre compte les DVD en stock et ceux en file d'attente (copies garanties). Le ratio visé est celui de tes ventes : le script lit dans les réponses de Torn le nombre de DVD vendus par genre depuis le début (statistiques du crime) et s'en sert dès 2 000 DVD vendus ; avant, il prend un ratio communautaire fixe (54 / 38 / 30 / 38 / 16 / 16 / 22 / 11, d'Action à Sci-Fi) ; les cibles sont ce ratio appliqué au stock total où mèneront les copies conseillées, compte tenu des copies moyennes par clic. Écart en orange tant que le genre est hors tolérance (15 % de la cible, en plus comme en moins) ou qu'il reste des copies prévues pour ce genre, en vert sinon.

- À chaque **Copy**, le script lit dans la réponse de Torn le nombre de copies lancées (« Copying 14 Action DVDs ») et le mémorise avec le genre et le niveau de Bootlegging. Il en tire une moyenne de copies par clic, par genre et par niveau.
- **Stock minimal** : tant que le stock total (en stock + en file) est sous ce minimum, il conseille de copier. Le minimum n'est pas fixe : c'est le stock où une demi-copie (l'erreur d'arrondi d'un clic) tient dans la tolérance pour chaque genre, le plus petit compris ; il suit donc les copies moyennes par clic. Stock et minimum sont affichés dans l'en-tête.
- Moins de DVD vierges déballés que de copies par clic : liseré rouge sur le bouton d'ajout des Blank DVDs (sinon Torn grise tout sans dire pourquoi).
- Sell reste grisé tant que le conseil n'est pas de vendre (copies à faire ou en cours), Copy quand il n'y a rien à copier. Le script désactive alors le bouton comme Torn le fait faute de nerve, avec la raison en info-bulle au survol ; il ne réactive jamais un bouton que Torn a désactivé.
- Il conseille le genre dont une copie rapproche le plus le stock du ratio, le **présélectionne** et l'encadre en vert : il ne reste qu'à cliquer sur **Copy**. Une copie qui dépasse la cible d'un genre reste conseillée si elle rapproche l'ensemble du ratio : les cibles montent alors avec le stock, sans bond inutile.
- Quand tous les genres sont dans la tolérance, ou qu'aucune copie ne rapproche plus du ratio (pas de recherche sans fin du ratio parfait) : **Sell** encadré en vert et Copy grisé s'il n'y a rien en file d'attente ; sinon Copy et Sell sont grisés, avec un message à côté de Sell : attendre la fin des copies avant de vendre.

La présélection d'un genre est un simple choix d'affichage, sans requête au serveur. Le script ne clique jamais sur Copy ni Sell.

### Graffiti : quartier et couleur

Sur la page Graffiti, seule la ligne du quartier à taguer maintenant est marquée : un liseré autour du choix de la bombe (**vert** si la couleur est la bonne, **rouge** sinon) et un liseré vert autour de **Spray**. Quand on ouvre le choix de la bombe depuis cette ligne, la bonne bombe est entourée de pointillés verts (si on n'en a pas, le liseré rouge renvoie au Print Store). Chaque marque a une info-bulle courte qui dit pourquoi.

Choix du quartier, dans cet ordre :

1. **Crew** : niveau 70, pas encore de crew, et R5 dans un quartier où une issue unique est disponible : ce quartier (issue unique qui fait rejoindre un crew).
2. **Outils** : Ladder (West Side, niveau 15), Wire Cutters (North Side, 25), Paint Mask (East Side, 35). Ils débloquent des issues en plus, souvent mieux payées, dans tous les quartiers, et semblent éviter des échecs critiques. Le quartier n'est conseillé que si l'outil y manque à coup sûr : plus d'issues uniques disponibles (étoiles sous Spray) que toutes les autres possibles à ce palier (Paint Mask : lu dans l'enhancer affiché par la page). Puis **accès à Residential** (East Side, niveau 50) tant que Residential est verrouillé. Les autres issues uniques (accès à Red-Light, issues de réputation) ne valent pas un détour : elles viendront plus tard.
3. Sinon, le **quartier le plus sûr** déjà débloqué : Residential (0,92 % d'échec), West Side, City Center, East Side, North Side, Financial, Red-Light.

Couleur : celle qui semble la meilleure pour la **réputation** tant que le quartier n'est pas à R5, puis celle qui semble la meilleure pour l'**argent** (East Side rouge puis violet, West Side bleu puis vert, North Side orange puis vert, Residential bleu puis blanc, Red-Light rose puis vert, Financial rouge puis noir, City Center bleu puis vert). Source : « [Crimes 2.0] Graffiti: An In-Depth Guide » (forum Torn) ; d'après son auteur, l'effet des couleurs est mal mesuré.

### Bootlegging : export et import de l'historique

Les conseils s'affinent avec l'historique des Copy mémorisé par le script. Pour le passer à un autre appareil ou navigateur (Torn PDA compris) : bouton **Sauvegarde** dans l'en-tête du bloc Bootlegging. La zone qui s'ouvre permet :

- **Exporter** l'historique des copies, avec pour information les moyennes de copies par clic (par genre et par niveau) et les réglages (ratio, tolérance) : en fichier `bootlegging-AAAA-MM-JJ.json`, ou en texte copié dans le presse-papiers (utile quand le téléchargement est bloqué, sur mobile par exemple) ;
- **Importer** un tel fichier, ou ce texte collé dans la zone : seul l'historique est repris, fusionné avec celui déjà présent (rien n'est effacé, une copie déjà connue n'est pas dupliquée). Moyennes et cibles en sont recalculées.

## Installation

- **Navigateur** : installer Violentmonkey (ou Tampermonkey), puis ouvrir [TornCrimeHelper.user.js](https://raw.githubusercontent.com/LittleBigDev/TornCrimeHelper/main/TornCrimeHelper.user.js) et cliquer sur **Installer**. Les mises à jour sont automatiques.
- **Torn PDA** : Settings, Userscripts, ajouter un script depuis l'URL https://raw.githubusercontent.com/LittleBigDev/TornCrimeHelper/main/TornCrimeHelper.user.js.

## Reprise depuis TornBastTools

Jusqu'à sa version 1.39, TornBastTools contenait cette aide. Pour garder l'historique des copies : dans TornBastTools 1.39, bouton **Sauvegarde** du bloc Bootlegging, **Exporter** ; puis dans TornCrimeHelper, même bouton, **Importer**. Le format est le même.
