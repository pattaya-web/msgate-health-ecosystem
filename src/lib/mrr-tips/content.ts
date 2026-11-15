/**
 * MRR Tips & Tricks — fiches tirées des notes de @mr_mrr4, traduites et
 * classées. L'ordre suit le document d'origine.
 *
 * Volontairement absentes : les techniques qui trompent un client ou un
 * processeur de paiement (faire croire au client qu'il s'est abonné, cacher
 * les conditions de l'abonnement, faux avis / faux abonnés / faux
 * commentaires, prête-noms et KYC par proxy pour obtenir des MID, faux contrat
 * de fulfilment US, nouvelle LLC pour contourner un refus, courriers de
 * chargeback cachés, publicités recopiées de la bibliothèque Meta). Elles
 * exposent à la fraude et font fermer les MID ; elles n'ont pas leur place
 * dans l'outil.
 */

export type TipCategory =
  | "Communication client"
  | "Abonnement"
  | "Service client"
  | "Litiges & chargebacks"
  | "MID & processeurs"
  | "Produit & livraison"
  | "Chiffres & profit"
  | "Réseaux sociaux";

export const TIP_CATEGORIES: TipCategory[] = [
  "Communication client",
  "Abonnement",
  "Service client",
  "Litiges & chargebacks",
  "MID & processeurs",
  "Produit & livraison",
  "Chiffres & profit",
  "Réseaux sociaux",
];

export type Tip = {
  id: string;
  category: TipCategory;
  title: string;
  /** L'idée en une phrase, visible sans ouvrir la fiche. */
  summary: string;
  body: string[];
  bullets?: string[];
  steps?: string[];
  /** Un texte prêt à copier (SMS, e-mail, message vocal…). */
  example?: { label: string; text: string };
};

export const TIPS: Tip[] = [
  {
    id: "sms-confirmation",
    category: "Communication client",
    title: "Un SMS juste après la commande",
    summary: "Un SMS de confirmation avec le contact du support : lu bien plus qu'un e-mail, il évite le réflexe « banque ».",
    body: [
      "Envoie un SMS juste après chaque commande. Ça se règle en 5 minutes dans Klaviyo.",
      "Dans le checkout builder Phoenix, rends le numéro de téléphone obligatoire pour que chaque client puisse le recevoir.",
      "Dans le SMS, affiche clairement les coordonnées du support. Le taux d'ouverture d'un SMS est bien plus élevé que celui d'un e-mail : même un client qui ignore tes e-mails le verra.",
      "Plus tard, s'il remarque un prélèvement, il se souviendra du message et saura comment te joindre. Tout doit l'orienter vers ton support, pas vers un chargeback : s'il sait te joindre vite, il t'écrira avant d'appeler sa banque.",
    ],
    example: {
      label: "Modèle de SMS",
      text: "Thank you for your order at MYBRAND.\nWe've received your order and our team is preparing it now.\nOrder: {{ event.extra.order_number }}\nWe'll send you another email as soon as your order ships.\nOur support team is available daily from 8am to 8pm EST.\n📧 support@MYBRAND.com 📞 +1 XXXXXXXXXX",
    },
  },
  {
    id: "annulation-facile",
    category: "Abonnement",
    title: "Rendre l'annulation facile",
    summary: "Un bouton d'annulation visible et un e-mail de confirmation : une annulation coûte un abonné, un chargeback coûte bien plus.",
    body: [
      "Ne cache pas le bouton d'annulation, ne fais pas passer le client par mille étapes, ne l'oblige pas à écrire plusieurs fois pour annuler.",
      "Compliquer l'annulation crée de la friction, et la friction finit en litige. Le client est déjà agacé d'avoir été prélevé : ne l'énerve pas davantage. La grande majorité est satisfaite une fois l'abonnement annulé.",
      "Une annulation te coûte un abonné. Un chargeback te coûte un abonné, un remboursement, des frais de chargeback, des alertes et un risque accru sur tes processeurs. Le client le moins cher à perdre est souvent celui qui annule simplement.",
      "Mets en place un e-mail de confirmation d'annulation dans Klaviyo : un client qui ne sait pas si l'annulation a marché appelle sa banque « au cas où ».",
    ],
  },
  {
    id: "mid-iso",
    category: "MID & processeurs",
    title: "Passer par un ISO",
    summary: "Meilleurs taux, meilleur support, mise en place plus rapide, plus de choix de MID et plus de poids en cas de souci.",
    body: [
      "Passe toujours par un ISO. Plus ton ISO a de clients qui encaissent, plus il gagne d'argent : il a intérêt à garder tes boutiques en vie le plus longtemps possible.",
    ],
    bullets: ["Meilleurs taux", "Meilleur support", "Mise en place plus rapide", "Plus d'options de MID", "Plus de poids si tu as besoin d'aide"],
  },
  {
    id: "mid-limites",
    category: "MID & processeurs",
    title: "Ne jamais saturer ses MID",
    summary: "Encaisser régulièrement sous la limite inspire plus confiance que coller au plafond tous les jours.",
    body: [
      "Ce n'est pas parce qu'un processeur te donne une limite que tu dois la toucher chaque jour. Un volume régulier et stable rassure bien plus qu'un compte toujours au plafond.",
    ],
  },
  {
    id: "dispute-ratio",
    category: "Litiges & chargebacks",
    title: "Surveiller son taux de litiges",
    summary: "Le vérifier souvent, sans attendre que le processeur t'appelle.",
    body: ["N'attends pas que ton processeur te contacte. Vérifie ton taux de litiges régulièrement et règle les problèmes tôt, avant qu'ils grossissent."],
  },
  {
    id: "plusieurs-mid",
    category: "MID & processeurs",
    title: "Ne pas dépendre d'un seul processeur",
    summary: "Plusieurs MID déclarés, chacun pour son activité approuvée : une panne ne coupe pas tout.",
    body: [
      "Ne compte jamais sur un seul processeur. Avoir plusieurs MID te donne des solutions de secours si l'un d'eux a un problème ou tombe.",
      "Chaque MID doit rester utilisé pour l'activité et la boutique pour lesquelles il a été approuvé.",
    ],
  },
  {
    id: "mid-actifs",
    category: "MID & processeurs",
    title: "Traiter ses MID comme des actifs",
    summary: "Un bon MID se protège : mieux vaut le garder six mois de plus que forcer quelques prélèvements cette semaine.",
    body: [
      "Les bons MID sont durs à obtenir : protège-les. Ne cours pas après chaque dernier prélèvement si ça fait prendre un risque inutile à tes processeurs.",
      "Garder un MID sain en vie six mois de plus vaut généralement bien plus que quelques prélèvements en plus cette semaine.",
    ],
  },
  {
    id: "service-client",
    category: "Service client",
    title: "Le service client avant tout",
    summary: "C'est souvent la partie la plus importante : répondre à chaque client en moins de 2 heures quand c'est possible.",
    body: [
      "Ton service client est sans doute la partie la plus importante du business : c'est la différence entre une boutique qui tient des années et une qui se bat en permanence avec les remboursements, les chargebacks et les processeurs.",
      "Réponds à chaque client en moins de 2 heures quand c'est possible. Tes clients sont déjà agacés : plus tu les fais attendre, plus ils risquent d'appeler leur banque. Les réponses rapides évitent à elles seules beaucoup de litiges.",
    ],
  },
  {
    id: "client-satisfait",
    category: "Service client",
    title: "Laisser chaque client à peu près satisfait",
    summary: "Pas toujours un remboursement complet ; un ton professionnel ; le but est la résolution, pas de gagner la discussion.",
    body: [
      "Tous les clients n'ont pas besoin d'un remboursement complet. Parfois, rembourser le dernier prélèvement suffit. Parfois, ils voulaient juste une annulation rapide. Si un client menace d'un litige : rembourse.",
      "Garde un langage professionnel en toutes circonstances, comme une marque d'abonnement qui pèse plusieurs millions.",
      "Ton but n'est pas de gagner la discussion, c'est d'éloigner le client de sa banque. Chaque e-mail doit faire avancer vers une solution, pas créer plus de friction.",
      "Rends-toi facile à joindre : affiche ton e-mail et ton numéro de support partout (site, e-mails, SMS). Plus c'est simple de te contacter, moins le client fait de chargeback.",
    ],
  },
  {
    id: "smart-resolutions",
    category: "Litiges & chargebacks",
    title: "Smart Resolutions (Disputifier)",
    summary: "À activer dans Disputifier ; sinon, au minimum Order Insights et Compelling Evidence 3.0.",
    body: [
      "Active Smart Resolutions dans Disputifier. Au moment où ces notes ont été écrites, la fonction était en bêta et réservée aux clients à plus de 100 alertes de chargeback.",
      "Si elle n'est pas encore disponible, mets au minimum en place Order Insights et Compelling Evidence 3.0.",
    ],
  },
  {
    id: "carte-merci",
    category: "Service client",
    title: "Une carte de remerciement dans chaque colis",
    summary: "Le support mis en avant de façon très visible, pour que le client pense à toi avant sa banque.",
    body: [
      "Glisse une carte de remerciement dans chaque commande et rends ton service client ultra visible dessus, quitte à en faire beaucoup.",
      "Le client se souviendra de la carte s'il remarque un prélèvement plus tard. Tout doit l'orienter vers ton support plutôt que vers un chargeback.",
      "N'y écris que des affirmations vraies : pas de « 100 % de clients satisfaits » ou de note inventée.",
    ],
  },
  {
    id: "produit",
    category: "Produit & livraison",
    title: "Ton produit compte vraiment",
    summary: "Un produit qui plaît et qui arrive à temps : moins de clients en colère, moins de chargebacks.",
    body: [
      "Beaucoup sous-estiment ce point : tes clients doivent aimer ton produit, et le recevoir à temps. Ces deux choses pèsent énormément sur les chargebacks et sur la colère des clients.",
      "Un client qui aime le produit contacte d'abord ton support s'il remarque un prélèvement. Un client qui le déteste se sent arnaqué : il appelle sa banque, conteste l'achat d'origine et le prélèvement. Résultat : 2 frais d'alerte, 2 remboursements et le coût du produit perdu.",
      "Pense à toute l'expérience, de la commande jusqu'à la réception : meilleure elle est, plus ton taux de chargeback baisse.",
    ],
  },
  {
    id: "chiffres",
    category: "Chiffres & profit",
    title: "Suivre ses chiffres",
    summary: "Annulations, litiges, alertes, remboursements, approbations, rétention, motifs de refus : à suivre chaque jour.",
    body: [
      "Après 60 jours sur Phoenix, une section Insights regroupe tous tes chiffres. En attendant, suis-les à la main dans le back-office, et améliore-les un peu chaque jour : les petits progrès s'additionnent.",
    ],
    bullets: [
      "Taux d'annulation",
      "Taux de litiges",
      "Taux d'alertes de chargeback",
      "Taux de remboursement",
      "Taux d'approbation",
      "Rétention",
      "Motifs de refus des prélèvements",
    ],
  },
  {
    id: "profit",
    category: "Chiffres & profit",
    title: "Les prélèvements ne sont pas 100 % de profit",
    summary: "Compter tous les coûts avant de parler de bénéfice.",
    body: [
      "Grosse idée reçue : tes prélèvements récurrents ne sont pas du profit pur. Calcule toujours ton vrai bénéfice net, une fois tous les coûts déduits. Après 60 jours, Phoenix fournit un calculateur qui détaille tout.",
    ],
    bullets: [
      "Frais Phoenix",
      "Frais de traitement des MID",
      "Réserves glissantes (rolling reserve)",
      "Frais d'alertes de chargeback",
      "Frais de chargeback",
      "Remboursements",
      "Coût produit de la vente d'origine",
      "Dépense publicitaire",
      "Frais de passerelle de paiement",
    ],
  },
  {
    id: "cb-auto-cancel",
    category: "Litiges & chargebacks",
    title: "Alertes de chargeback = annulation automatique",
    summary: "Un client qui fait un chargeback ne doit plus jamais être prélevé.",
    body: [
      "Sur ta plateforme d'alertes, règle l'annulation automatique dans le CRM de tout client qui fait un chargeback. Un client déjà passé par sa banque ne doit plus recevoir de prélèvement, et tu n'as plus à annuler à la main à chaque alerte.",
    ],
  },
  {
    id: "abonnement-visible",
    category: "Abonnement",
    title: "Afficher l'abonnement dans les e-mails",
    summary: "Montrer l'abonnement et ses conditions : le client relie le prélèvement à ta marque au lieu de le contester.",
    body: [
      "Un client qui voit le VIP Membership dans sa confirmation de commande fait le lien quand le prélèvement arrive : moins de confusion, plus de chances qu'il contacte ton support plutôt que de faire un chargeback.",
      "Affiche l'abonnement, son prix et sa fréquence dans l'e-mail de confirmation, et un lien d'annulation. Le client doit avoir accepté clairement ces conditions au checkout : c'est ce qui te protège, auprès du client comme du processeur.",
      "Tu peux le retirer des e-mails d'expédition : l'abonnement n'est pas un produit expédié.",
    ],
  },
  {
    id: "premier-prelevement",
    category: "Abonnement",
    title: "Premier prélèvement après la réception",
    summary: "Délai de livraison de 7 jours → essai de 10 jours.",
    body: [
      "Fais toujours tomber le premier prélèvement après que le client a reçu son produit. Par exemple, avec 7 jours de livraison en moyenne, propose un essai gratuit de 10 jours.",
      "Si le prélèvement tombe avant la livraison, le risque de chargeback sur la commande et sur le prélèvement est beaucoup plus élevé.",
    ],
  },
  {
    id: "frais",
    category: "MID & processeurs",
    title: "Renégocier ses frais de traitement",
    summary: "Avec de l'historique et un compte propre, demande de meilleures conditions à ton ISO.",
    body: [
      "Après un moment de traitement, tu peux généralement négocier de meilleures conditions avec ton ISO. Ça devient possible avec de l'historique ou un volume correct : plus ton compte est propre, plus tu as de poids. Demande : au pire, c'est non.",
    ],
    bullets: ["Pourcentage de réserve plus bas", "Plafond de réserve", "Frais de traitement plus bas", "Meilleures conditions globales"],
  },
  {
    id: "deuxieme-boutique",
    category: "MID & processeurs",
    title: "Ouvrir une deuxième boutique",
    summary: "Nouvelle bank page et nouveau sous-domaine ; ne jamais prélever des clients sous un descripteur qu'ils ne reconnaissent pas.",
    body: [
      "Ce n'est pas aussi simple que créer un nouveau site Shopify. Les underwriters approuvent une bank page précise et te donnent ce nom de marque comme descripteur : il ne peut pas être remplacé par un nom complètement différent.",
      "Il est essentiel que les clients reconnaissent ton nom de marque quand un prélèvement tombe : ça réduit fortement les chargebacks et la confusion. Ne commence pas à prélever des clients sur des MID avec un descripteur totalement différent : beaucoup plus de chargebacks et de moins bons taux d'approbation.",
      "Il te faut une nouvelle bank page et un nouveau sous-domaine. Même sous la même LLC, le processeur peut refuser si ton historique n'est pas très propre, ou te donner des plafonds plus bas parce que tu as déjà un MID chez lui.",
    ],
  },
  {
    id: "messagerie-ia",
    category: "Service client",
    title: "Messagerie vocale qui renvoie vers l'e-mail",
    summary: "Jusqu'à 2 000–3 000 abonnés : un numéro US (exigé par les MID) avec un message qui oriente vers le support e-mail.",
    body: [
      "Les MID exigent un numéro de service client US. Jusqu'à 2 000 – 3 000 abonnés, un message vocal qui renvoie vers ton support e-mail suffit : la plupart des appels concernent un prélèvement non reconnu, et le client sait tout de suite où s'adresser.",
      "Une réponse rapide par e-mail reste non négociable pour éviter qu'il appelle sa banque.",
    ],
    steps: [
      "Va sur quo.com.",
      "Achète un numéro de téléphone US.",
      "Sur ce numéro : Settings → Call Flow → Edit Call Flow.",
      "Règle le parcours : Incoming call → Voicemail.",
      "Modifie le message d'accueil avec ton propre texte.",
    ],
    example: {
      label: "Message d'accueil",
      text: "Hi, thanks for calling BRANDNAME.\nIf you're calling about a recent membership charge, subscription renewal, or billing enquiry, our support team can assist you quickly via email.\nPlease email support@BRANDNAME.com and include the email address used when placing your order.\nAll enquiries are reviewed by a member of our team, and we typically respond within 2 hours during business hours, from 8am to 8pm Eastern Time, every day.\nThank you, and we look forward to helping you.",
    },
  },
  {
    id: "page-sociale",
    category: "Réseaux sociaux",
    title: "La page d'où partent tes pubs",
    summary: "Le client qui voit ta pub ouvre ton profil : il doit y voir une marque active, avec du vrai contenu.",
    body: [
      "Beaucoup de nouvelles boutiques soignent leurs créas et oublient leurs pages Facebook et Instagram. Pourtant, elles font partie du tunnel : devant une pub, le premier réflexe est d'ouvrir le profil et de se demander si c'est une vraie marque, si d'autres achètent, si le produit tient ses promesses, si la page est active. Une page avec cinq posts d'il y a six mois crée tout de suite un doute.",
      "30 minutes par semaine suffisent pour garder la page vivante.",
    ],
    bullets: [
      "Publier régulièrement photos et vidéos du produit (pas tout d'un coup)",
      "Stories à la une : avis clients réels, FAQ, livraison, meilleurs produits",
      "Bio, liens et identité visuelle propres et cohérents",
      "Partager les vrais retours et photos envoyés par tes clients, avec leur accord",
    ],
  },
  {
    id: "rembourser",
    category: "Litiges & chargebacks",
    title: "Rembourser les clients",
    summary: "Menace de chargeback ou d'action en justice : rembourser. Sinon, le dernier prélèvement peut suffire.",
    body: [
      "À toi de choisir ton niveau de fermeté. Si un client menace d'un chargeback ou d'une action en justice, rembourse : tu économises les frais d'alerte et tu calmes un client en colère.",
      "Face à un client très mécontent avec plusieurs prélèvements, rembourser le dernier et annuler peut suffire. Mais s'il menace toujours d'un litige, rembourse tout.",
      "C'est ce qui garde les boutiques en vie plus longtemps, avec des abonnés qui s'accumulent mois après mois. Ça arrive, et ça touche peut-être 2 % du chiffre : mieux vaut rembourser et passer à autre chose.",
    ],
    example: {
      label: "Réponse type (remboursement du dernier prélèvement)",
      text: "As a gesture of goodwill, we'll refund your most recent billing charge of $29.99 and cancel your membership immediately. You will not be charged again.",
    },
  },
  {
    id: "frais-alertes",
    category: "Litiges & chargebacks",
    title: "Négocier les frais d'alertes de chargeback",
    summary: "Au-delà de 100 alertes par mois : faire jouer la concurrence (Ethoca, RDR).",
    body: [
      "Au-delà de 100 alertes par mois, tu peux négocier. Écris au plus gros concurrent de ton fournisseur avec ton tarif actuel et ta croissance, en expliquant pourquoi tu envisages de changer.",
      "Avec une meilleure offre : change de fournisseur, ou montre-la à ton fournisseur actuel (Disputifier) et demande-lui de s'aligner. Aucun fournisseur ne veut perdre un compte en croissance pour quelques dollars par alerte.",
    ],
    example: {
      label: "Message au concurrent",
      text: "I'm currently using (Company) and paying $X per alert. Our monthly volume is growing by X% each month.\nCan you beat our current pricing?\nEthoca: $X\nRDR: $X",
    },
  },
  {
    id: "reponse-auto",
    category: "Communication client",
    title: "Réponse automatique sur chaque e-mail",
    summary: "Délais de réponse, suivi de commande, retours et centre d'aide : le client attend moins, il conteste moins.",
    body: [
      "Ajoute une réponse automatique à tous tes e-mails : tes délais de réponse et les liens vers ton centre d'aide et tes politiques importantes.",
      "Tu peux même mettre un lien vers la page d'annulation, la demande la plus fréquente (un centre d'aide est encore mieux). Moins le client attend une réponse, moins il risque de lancer un litige.",
    ],
    bullets: ["Horaires du support (ex. 7 j/7, 8 h – 20 h EST) et délai de réponse", "Suivi de commande", "Retours et remboursements", "Centre d'aide"],
  },
  {
    id: "objectif",
    category: "Abonnement",
    title: "L'objectif du VIP Club",
    summary: "Support plus simple que la banque, rentabilité dès la première vente, abonnés qui s'accumulent.",
    body: [],
    steps: [
      "Rendre ton support 10 fois plus simple à joindre qu'un litige bancaire.",
      "Être à l'équilibre sur la première vente et acquérir le plus de clients possible chaque jour.",
      "Accumuler les abonnés mois après mois.",
    ],
  },
];
