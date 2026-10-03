/**
 * Voix ElevenLabs disponibles via KIE (modele elevenlabs/text-to-speech-multilingual-v2).
 *
 * Liste extraite de la doc KIE (.cache/kie-docs/elevenlabs_text-to-speech-multilingual-v2.md).
 * Le genre et l'age sont deduits du prenom : KIE ne publie pas ces etiquettes.
 * Apercu : https://static.aiquickdraw.com/elevenlabs/voice/<id>.mp3
 */
import type { VoiceInfo } from "./types";

export const KIE_TTS_MODEL = "elevenlabs/text-to-speech-multilingual-v2";
export const KIE_VOICE_PREVIEW = (id: string) => `https://static.aiquickdraw.com/elevenlabs/voice/${id}.mp3`;

const RAW: { id: string; name: string; description: string; gender: string; age: string }[] = [
  {
    "id": "EkK5I93UQWFDigLMpZcX",
    "name": "James",
    "description": "Husky, Engaging and Bold",
    "gender": "male",
    "age": ""
  },
  {
    "id": "Z3R5wn05IrDiVCyEkUrK",
    "name": "Arabella",
    "description": "Mysterious and Emotive",
    "gender": "female",
    "age": ""
  },
  {
    "id": "NNl6r8mD7vthiJatiJt1",
    "name": "Bradford",
    "description": "Expressive and Articulate",
    "gender": "male",
    "age": ""
  },
  {
    "id": "YOq2y2Up4RgXP2HyXjE5",
    "name": "Xavier",
    "description": "Dominating, Metallic Announcer",
    "gender": "male",
    "age": ""
  },
  {
    "id": "B8gJV1IhpuegLxdpXFOE",
    "name": "Kuon",
    "description": "Cheerful, Clear and Steady",
    "gender": "female",
    "age": "young"
  },
  {
    "id": "2zRM7PkgwBPiau2jvVXc",
    "name": "Monika Sogam",
    "description": "Deep and Natural",
    "gender": "female",
    "age": ""
  },
  {
    "id": "1SM7GgM6IMuvQlz2BwM3",
    "name": "Mark",
    "description": "Casual, Relaxed and Light",
    "gender": "male",
    "age": ""
  },
  {
    "id": "5l5f8iK3YPeGga21rQIX",
    "name": "Adeline",
    "description": "Feminine and Conversational",
    "gender": "female",
    "age": ""
  },
  {
    "id": "scOwDtmlUjD3prqpp97I",
    "name": "Sam",
    "description": "Support Agent",
    "gender": "male",
    "age": ""
  },
  {
    "id": "NOpBlnGInO9m6vDvFkFC",
    "name": "Spuds Oxley",
    "description": "Wise and Approachable",
    "gender": "male",
    "age": ""
  },
  {
    "id": "BZgkqPqms7Kj9ulSkVzn",
    "name": "Eve",
    "description": "Authentic, Energetic and Happy",
    "gender": "female",
    "age": "young"
  },
  {
    "id": "wo6udizrrtpIxWGp2qJk",
    "name": "Northern Terry",
    "description": "",
    "gender": "male",
    "age": ""
  },
  {
    "id": "gU0LNdkMOQCOrPrwtbee",
    "name": "British Football Announcer",
    "description": "",
    "gender": "male",
    "age": ""
  },
  {
    "id": "DGzg6RaUqxGRTHSBjfgF",
    "name": "Brock",
    "description": "Commanding and Loud Sergeant",
    "gender": "male",
    "age": ""
  },
  {
    "id": "x70vRnQBMBu4FAYhjJbO",
    "name": "Nathan",
    "description": "Virtual Radio Host",
    "gender": "male",
    "age": ""
  },
  {
    "id": "Sm1seazb4gs7RSlUVw7c",
    "name": "Anika",
    "description": "Animated, Friendly and Engaging",
    "gender": "female",
    "age": "young"
  },
  {
    "id": "P1bg08DkjqiVEzOn76yG",
    "name": "Viraj",
    "description": "Rich and Soft",
    "gender": "male",
    "age": ""
  },
  {
    "id": "qDuRKMlYmrm8trt5QyBn",
    "name": "Taksh",
    "description": "Calm, Serious and Smooth",
    "gender": "male",
    "age": ""
  },
  {
    "id": "qXpMhyvQqiRxWQs4qSSB",
    "name": "Horatius",
    "description": "Energetic Character Voice",
    "gender": "male",
    "age": ""
  },
  {
    "id": "TX3LPaxmHKxFdv7VOQHJ",
    "name": "Liam",
    "description": "Energetic, Social Media Creator",
    "gender": "male",
    "age": "young"
  },
  {
    "id": "N2lVS1w4EtoT3dr4eOWO",
    "name": "Callum",
    "description": "Husky Trickster",
    "gender": "male",
    "age": ""
  },
  {
    "id": "FGY2WhTYpPnrIDTdsKH5",
    "name": "Laura",
    "description": "Enthusiast, Quirky Attitude",
    "gender": "female",
    "age": "young"
  },
  {
    "id": "kPzsL2i3teMYv0FxEYQ6",
    "name": "Brittney",
    "description": "Social Media Voice - Fun, Youthful & Informative",
    "gender": "female",
    "age": "young"
  },
  {
    "id": "UgBBYS2sOqTuMpoF3BR0",
    "name": "Mark",
    "description": "Natural Conversations",
    "gender": "male",
    "age": ""
  },
  {
    "id": "hpp4J3VqNfWAUOO0d1Us",
    "name": "Bella",
    "description": "Professional, Bright, Warm",
    "gender": "female",
    "age": ""
  },
  {
    "id": "nPczCjzI2devNBz1zQrb",
    "name": "Brian",
    "description": "Deep, Resonant and Comforting",
    "gender": "male",
    "age": ""
  },
  {
    "id": "uYXf8XasLslADfZ2MB4u",
    "name": "Hope",
    "description": "Bubbly, Gossipy and Girly",
    "gender": "female",
    "age": "young"
  },
  {
    "id": "gs0tAILXbY5DNrJrsM6F",
    "name": "Jeff",
    "description": "Classy, Resonating and Strong",
    "gender": "male",
    "age": ""
  },
  {
    "id": "DTKMou8ccj1ZaWGBiotd",
    "name": "Jamahal",
    "description": "Young, Vibrant, and Natural",
    "gender": "male",
    "age": "young"
  },
  {
    "id": "vBKc2FfBKJfcZNyEt1n6",
    "name": "Finn",
    "description": "Youthful, Eager and Energetic",
    "gender": "male",
    "age": "young"
  },
  {
    "id": "DYkrAHD8iwork3YSUBbs",
    "name": "Tom",
    "description": "Conversations & Books",
    "gender": "male",
    "age": ""
  },
  {
    "id": "56AoDkrOh6qfVPDXZ7Pt",
    "name": "Cassidy",
    "description": "Crisp, Direct and Clear",
    "gender": "female",
    "age": ""
  },
  {
    "id": "eR40ATw9ArzDf9h3v7t7",
    "name": "Addison 2.0",
    "description": "Australian Audiobook & Podcast",
    "gender": "female",
    "age": ""
  },
  {
    "id": "g6xIsTj2HwM6VR4iXFCw",
    "name": "Jessica Anne Bogart",
    "description": "Chatty and Friendly",
    "gender": "female",
    "age": ""
  },
  {
    "id": "lcMyyd2HUfFzxdCaC4Ta",
    "name": "Lucy",
    "description": "Fresh & Casual",
    "gender": "female",
    "age": "young"
  },
  {
    "id": "6aDn1KB0hjpdcocrUkmq",
    "name": "Tiffany",
    "description": "Natural and Welcoming",
    "gender": "female",
    "age": ""
  },
  {
    "id": "Sq93GQT4X1lKDXsQcixO",
    "name": "Felix",
    "description": "Warm, Positive & Contemporary RP",
    "gender": "male",
    "age": ""
  },
  {
    "id": "flHkNRp1BlvT73UL6gyz",
    "name": "Jessica Anne Bogart",
    "description": "Eloquent Villain",
    "gender": "female",
    "age": ""
  },
  {
    "id": "9yzdeviXkFddZ4Oz8Mok",
    "name": "Lutz",
    "description": "Chuckling, Giggly and Cheerful",
    "gender": "male",
    "age": ""
  },
  {
    "id": "pPdl9cQBQq4p6mRkZy2Z",
    "name": "Emma",
    "description": "Adorable and Upbeat",
    "gender": "female",
    "age": "young"
  },
  {
    "id": "zYcjlYFOd3taleS0gkk3",
    "name": "Edward",
    "description": "Loud, Confident and Cocky",
    "gender": "male",
    "age": ""
  },
  {
    "id": "nzeAacJi50IvxcyDnMXa",
    "name": "Marshal",
    "description": "Friendly, Funny Professor",
    "gender": "male",
    "age": ""
  },
  {
    "id": "ruirxsoakN0GWmGNIo04",
    "name": "John Morgan",
    "description": "Gritty, Rugged Cowboy",
    "gender": "male",
    "age": ""
  },
  {
    "id": "TC0Zp7WVFzhA8zpTlRqV",
    "name": "Aria",
    "description": "Sultry Villain",
    "gender": "female",
    "age": ""
  },
  {
    "id": "ljo9gAlSqKOvF6D8sOsX",
    "name": "Viking Bjorn",
    "description": "Epic Medieval Raider",
    "gender": "male",
    "age": ""
  },
  {
    "id": "PPzYpIqttlTYA83688JI",
    "name": "Pirate Marshal",
    "description": "",
    "gender": "male",
    "age": ""
  },
  {
    "id": "8JVbfL6oEdmuxKn5DK2C",
    "name": "Johnny Kid",
    "description": "Serious and Calm Narrator",
    "gender": "male",
    "age": ""
  },
  {
    "id": "iCrDUkL56s3C8sCRl7wb",
    "name": "Hope",
    "description": "Poetic, Romantic and Captivating",
    "gender": "female",
    "age": "young"
  },
  {
    "id": "wJqPPQ618aTW29mptyoc",
    "name": "Ana Rita",
    "description": "Smooth, Expressive and Bright",
    "gender": "female",
    "age": ""
  },
  {
    "id": "EiNlNiXeDU1pqqOPrYMO",
    "name": "John Doe",
    "description": "Deep",
    "gender": "male",
    "age": ""
  },
  {
    "id": "4YYIPFl9wE5c4L2eu2Gb",
    "name": "Burt Reynolds™",
    "description": "Deep, Smooth and Clear",
    "gender": "male",
    "age": ""
  },
  {
    "id": "6F5Zhi321D3Oq7v1oNT4",
    "name": "Hank",
    "description": "Deep and Engaging Narrator",
    "gender": "male",
    "age": ""
  },
  {
    "id": "YXpFCvM1S3JbWEJhoskW",
    "name": "Wyatt",
    "description": "Wise Rustic Cowboy",
    "gender": "male",
    "age": ""
  },
  {
    "id": "LG95yZDEHg6fCZdQjLqj",
    "name": "Phil",
    "description": "Explosive, Passionate Announcer",
    "gender": "male",
    "age": ""
  },
  {
    "id": "CeNX9CMwmxDxUF5Q2Inm",
    "name": "Johnny Dynamite",
    "description": "Vintage Radio DJ",
    "gender": "male",
    "age": ""
  },
  {
    "id": "aD6riP1btT197c6dACmy",
    "name": "Rachel M",
    "description": "Pro British Radio Presenter",
    "gender": "female",
    "age": ""
  },
  {
    "id": "mtrellq69YZsNwzUSyXh",
    "name": "Rex Thunder",
    "description": "Deep N Tough",
    "gender": "male",
    "age": ""
  },
  {
    "id": "dHd5gvgSOzSfduK4CvEg",
    "name": "Ed",
    "description": "Late Night Announcer",
    "gender": "male",
    "age": ""
  },
  {
    "id": "eVItLK1UvXctxuaRV2Oq",
    "name": "Jean",
    "description": "Alluring and Playful Femme Fatale",
    "gender": "female",
    "age": ""
  },
  {
    "id": "esy0r39YPLQjOczyOib8",
    "name": "Britney",
    "description": "Calm and Calculative Villain",
    "gender": "female",
    "age": ""
  },
  {
    "id": "Tsns2HvNFKfGiNjllgqo",
    "name": "Sven",
    "description": "Emotional and Nice",
    "gender": "male",
    "age": ""
  },
  {
    "id": "1U02n4nD6AdIZ9CjF053",
    "name": "Viraj",
    "description": "Smooth and Gentle",
    "gender": "male",
    "age": ""
  },
  {
    "id": "AeRdCCKzvd23BpJoofzx",
    "name": "Nathaniel",
    "description": "Engaging, British and Calm",
    "gender": "male",
    "age": ""
  },
  {
    "id": "LruHrtVF6PSyGItzMNHS",
    "name": "Benjamin",
    "description": "Deep, Warm, Calming",
    "gender": "male",
    "age": ""
  },
  {
    "id": "1wGbFxmAM3Fgw63G1zZJ",
    "name": "Allison",
    "description": "Calm, Soothing and Meditative",
    "gender": "female",
    "age": ""
  },
  {
    "id": "hqfrgApggtO1785R4Fsn",
    "name": "Theodore HQ",
    "description": "Serene and Grounded",
    "gender": "",
    "age": ""
  },
  {
    "id": "MJ0RnG71ty4LH3dvNfSd",
    "name": "Leon",
    "description": "Soothing and Grounded enum: -",
    "gender": "",
    "age": ""
  },
  {
    "id": "hqfrgApggtO1785R4Fsn",
    "name": "MJ0RnG71ty4LH3dvNfSd default: EkK5I93UQWFDigLMpZcX x-apidog-enum:",
    "description": "value: EkK5I93UQWFDigLMpZcX name: '' description: '' - value: Z3R5wn05IrDiVCyEkUrK name: '' description: '' - value: NNl6r8mD7vthiJatiJt1 name: '' description: '' - value: YOq2y2Up4RgXP2HyXjE5 name: '' description: '' - value: B8gJV1IhpuegLxdpXFOE name: '' description: '' - value: 2zRM7PkgwBPiau2jvVXc name: '' description: '' - value: 1SM7GgM6IMuvQlz2BwM3 name: '' description: '' - value: 5l5f8iK3YPeGga21rQIX name: '' description: '' - value: scOwDtmlUjD3prqpp97I name: '' description: '' - value: NOpBlnGInO9m6vDvFkFC name: '' description: '' - value: BZgkqPqms7Kj9ulSkVzn name: '' description: '' - value: wo6udizrrtpIxWGp2qJk name: '' description: '' - value: gU0LNdkMOQCOrPrwtbee name: '' description: '' - value: DGzg6RaUqxGRTHSBjfgF name: '' description: '' - value: x70vRnQBMBu4FAYhjJbO name: '' description: '' - value: Sm1seazb4gs7RSlUVw7c name: '' description: '' - value: P1bg08DkjqiVEzOn76yG name: '' description: '' - value: qDuRKMlYmrm8trt5QyBn name: '' description: '' - value: qXpMhyvQqiRxWQs4qSSB name: '' description: '' - value: TX3LPaxmHKxFdv7VOQHJ name: '' description: '' - value: N2lVS1w4EtoT3dr4eOWO name: '' description: '' - value: FGY2WhTYpPnrIDTdsKH5 name: '' description: '' - value: kPzsL2i3teMYv0FxEYQ6 name: '' description: '' - value: UgBBYS2sOqTuMpoF3BR0 name: '' description: '' - value: hpp4J3VqNfWAUOO0d1Us name: '' description: '' - value: nPczCjzI2devNBz1zQrb name: '' description: '' - value: uYXf8XasLslADfZ2MB4u name: '' description: '' - value: gs0tAILXbY5DNrJrsM6F name: '' description: '' - value: DTKMou8ccj1ZaWGBiotd name: '' description: '' - value: vBKc2FfBKJfcZNyEt1n6 name: '' description: '' - value: DYkrAHD8iwork3YSUBbs name: '' description: '' - value: 56AoDkrOh6qfVPDXZ7Pt name: '' description: '' - value: eR40ATw9ArzDf9h3v7t7 name: '' description: '' - value: g6xIsTj2HwM6VR4iXFCw name: '' description: '' - value: lcMyyd2HUfFzxdCaC4Ta name: '' description: '' - value: 6aDn1KB0hjpdcocrUkmq name: '' description: '' - value: Sq93GQT4X1lKDXsQcixO name: '' description: '' - value: flHkNRp1BlvT73UL6gyz name: '' description: '' - value: 9yzdeviXkFddZ4Oz8Mok name: '' description: '' - value: pPdl9cQBQq4p6mRkZy2Z name: '' description: '' - value: zYcjlYFOd3taleS0gkk3 name: '' description: '' - value: nzeAacJi50IvxcyDnMXa name: '' description: '' - value: ruirxsoakN0GWmGNIo04 name: '' description: '' - value: TC0Zp7WVFzhA8zpTlRqV name: '' description: '' - value: ljo9gAlSqKOvF6D8sOsX name: '' description: '' - value: PPzYpIqttlTYA83688JI name: '' description: '' - value: 8JVbfL6oEdmuxKn5DK2C name: '' description: '' - value: iCrDUkL56s3C8sCRl7wb name: '' description: '' - value: wJqPPQ618aTW29mptyoc name: '' description: '' - value: EiNlNiXeDU1pqqOPrYMO name: '' description: '' - value: 4YYIPFl9wE5c4L2eu2Gb name: '' description: '' - value: 6F5Zhi321D3Oq7v1oNT4 name: '' description: '' - value: YXpFCvM1S3JbWEJhoskW name: '' description: '' - value: LG95yZDEHg6fCZdQjLqj name: '' description: '' - value: CeNX9CMwmxDxUF5Q2Inm name: '' description: '' - value: aD6riP1btT197c6dACmy name: '' description: '' - value: mtrellq69YZsNwzUSyXh name: '' description: '' - value: dHd5gvgSOzSfduK4CvEg name: '' description: '' - value: eVItLK1UvXctxuaRV2Oq name: '' description: '' - value: esy0r39YPLQjOczyOib8 name: '' description: '' - value: Tsns2HvNFKfGiNjllgqo name: '' description: '' - value: 1U02n4nD6AdIZ9CjF053 name: '' description: '' - value: AeRdCCKzvd23BpJoofzx name: '' description: '' - value: LruHrtVF6PSyGItzMNHS name: '' description: '' - value: 1wGbFxmAM3Fgw63G1zZJ name: '' description: '' - value: hqfrgApggtO1785R4Fsn name: '' description: '' - value: MJ0RnG71ty4LH3dvNfSd name: '' description: ''",
    "gender": "",
    "age": ""
  }
];

export const KIE_VOICES: VoiceInfo[] = RAW.map((v) => ({
  id: v.id,
  name: v.name,
  category: "kie",
  gender: v.gender,
  age: v.age,
  accent: "",
  description: v.description,
  previewUrl: KIE_VOICE_PREVIEW(v.id),
}));
