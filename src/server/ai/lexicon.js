'use strict';
/**
 * Mood/vibe lexicon.
 *
 * Each entry maps natural language to (a) a target point in a 5-dimensional
 * audio-feature space and (b) catalog search queries that actually return
 * matching music. This is what makes "rainy night drive, moody afrobeats"
 * resolve into real tracks without an LLM in the loop.
 *
 * Feature dims: energy, valence (happiness), danceability, acousticness, tempo
 * (all normalised 0..1; tempo 0.5 ≈ 120bpm)
 */

const MOODS = {
  chill: {
    aliases: ['chill', 'chilled', 'relaxed', 'relaxing', 'laid back', 'laidback', 'mellow', 'calm', 'easy'],
    features: { energy: 0.3, valence: 0.55, danceability: 0.45, acousticness: 0.6, tempo: 0.35 },
    queries: ['chill vibes', 'lo-fi chill', 'mellow soul', 'downtempo'],
  },
  hype: {
    aliases: ['hype', 'hyped', 'energetic', 'energy', 'pumped', 'turnt', 'banger', 'bangers', 'gym', 'workout', 'running'],
    features: { energy: 0.95, valence: 0.7, danceability: 0.85, acousticness: 0.1, tempo: 0.8 },
    queries: ['workout hype', 'gym motivation', 'high energy anthems', 'trap bangers'],
  },
  sad: {
    aliases: ['sad', 'sadness', 'heartbreak', 'heartbroken', 'crying', 'melancholy', 'melancholic', 'blue', 'lonely', 'breakup'],
    features: { energy: 0.3, valence: 0.15, danceability: 0.35, acousticness: 0.65, tempo: 0.3 },
    queries: ['heartbreak ballads', 'sad songs', 'melancholy indie', 'emotional r&b'],
  },
  happy: {
    aliases: ['happy', 'joy', 'joyful', 'feel good', 'feelgood', 'sunny', 'upbeat', 'cheerful', 'good mood'],
    features: { energy: 0.75, valence: 0.95, danceability: 0.8, acousticness: 0.25, tempo: 0.65 },
    queries: ['feel good hits', 'happy pop', 'sunshine pop', 'good vibes'],
  },
  moody: {
    aliases: ['moody', 'dark', 'brooding', 'atmospheric', 'nocturnal', 'late night', 'midnight', 'gloomy', 'rainy'],
    features: { energy: 0.45, valence: 0.25, danceability: 0.5, acousticness: 0.4, tempo: 0.42 },
    queries: ['dark r&b', 'moody alternative', 'late night vibes', 'atmospheric'],
  },
  romantic: {
    aliases: ['romantic', 'love', 'valentine', 'date night', 'slow jam', 'slow jams', 'sensual', 'intimate'],
    features: { energy: 0.4, valence: 0.7, danceability: 0.55, acousticness: 0.5, tempo: 0.4 },
    queries: ['love songs', 'slow jams', 'romantic r&b', 'soul ballads'],
  },
  focus: {
    aliases: ['focus', 'study', 'studying', 'work', 'working', 'concentration', 'deep work', 'coding', 'reading'],
    features: { energy: 0.3, valence: 0.5, danceability: 0.3, acousticness: 0.7, tempo: 0.4 },
    queries: ['study focus instrumental', 'ambient focus', 'lo-fi beats', 'piano instrumental'],
  },
  party: {
    aliases: ['party', 'club', 'dance', 'dancing', 'rave', 'weekend', 'friday night', 'celebration', 'turn up'],
    features: { energy: 0.9, valence: 0.85, danceability: 0.95, acousticness: 0.08, tempo: 0.75 },
    queries: ['party anthems', 'club bangers', 'dance floor hits', 'house party'],
  },
  nostalgic: {
    aliases: ['nostalgic', 'nostalgia', 'throwback', 'oldies', 'classic', 'retro', 'memories', '90s', '2000s', '80s'],
    features: { energy: 0.6, valence: 0.65, danceability: 0.6, acousticness: 0.35, tempo: 0.55 },
    queries: ['90s throwback hits', '2000s classics', 'retro pop', 'old school'],
  },
  driving: {
    aliases: ['driving', 'drive', 'road trip', 'roadtrip', 'highway', 'cruising', 'commute'],
    features: { energy: 0.7, valence: 0.6, danceability: 0.6, acousticness: 0.2, tempo: 0.6 },
    queries: ['road trip anthems', 'driving rock', 'cruising playlist'],
  },
  sleep: {
    aliases: ['sleep', 'sleepy', 'bedtime', 'insomnia', 'dreamy', 'ambient', 'meditation', 'spa', 'unwind'],
    features: { energy: 0.12, valence: 0.45, danceability: 0.15, acousticness: 0.9, tempo: 0.2 },
    queries: ['sleep ambient', 'meditation calm', 'dreamy ambient', 'peaceful piano'],
  },
  confident: {
    aliases: ['confident', 'boss', 'swagger', 'power', 'badass', 'unbothered', 'main character', 'ceo'],
    features: { energy: 0.8, valence: 0.7, danceability: 0.8, acousticness: 0.12, tempo: 0.65 },
    queries: ['confidence anthems', 'boss mode hip hop', 'power pop'],
  },
};

const GENRES = {
  afrobeats: {
    aliases: ['afrobeats', 'afrobeat', 'afro beats', 'afro', 'naija', 'nigerian', 'amapiano', 'afropop', 'afro fusion'],
    queries: ['afrobeats hits', 'amapiano', 'naija afrobeats', 'afro fusion'],
    features: { energy: 0.75, valence: 0.8, danceability: 0.9, acousticness: 0.15, tempo: 0.55 },
  },
  hiphop: {
    aliases: ['hip hop', 'hiphop', 'rap', 'trap', 'drill', 'boom bap'],
    queries: ['hip hop hits', 'rap essentials', 'trap'],
    features: { energy: 0.75, valence: 0.5, danceability: 0.8, acousticness: 0.1, tempo: 0.55 },
  },
  rnb: {
    aliases: ['r&b', 'rnb', 'rhythm and blues', 'soul', 'neo soul', 'neosoul'],
    queries: ['r&b hits', 'neo soul', 'contemporary rnb'],
    features: { energy: 0.5, valence: 0.55, danceability: 0.65, acousticness: 0.35, tempo: 0.45 },
  },
  pop: {
    aliases: ['pop', 'top 40', 'mainstream', 'radio'],
    queries: ['pop hits', 'top 40', 'pop anthems'],
    features: { energy: 0.7, valence: 0.75, danceability: 0.75, acousticness: 0.2, tempo: 0.6 },
  },
  rock: {
    aliases: ['rock', 'indie rock', 'alternative', 'alt rock', 'punk', 'metal', 'grunge'],
    queries: ['rock classics', 'indie rock', 'alternative rock'],
    features: { energy: 0.85, valence: 0.55, danceability: 0.5, acousticness: 0.2, tempo: 0.68 },
  },
  electronic: {
    aliases: ['electronic', 'edm', 'house', 'techno', 'dubstep', 'drum and bass', 'dnb', 'synth', 'deep house'],
    queries: ['electronic dance', 'deep house', 'techno essentials'],
    features: { energy: 0.85, valence: 0.65, danceability: 0.9, acousticness: 0.05, tempo: 0.78 },
  },
  jazz: {
    aliases: ['jazz', 'bebop', 'swing', 'blues', 'saxophone'],
    queries: ['jazz classics', 'smooth jazz', 'blues essentials'],
    features: { energy: 0.4, valence: 0.55, danceability: 0.45, acousticness: 0.8, tempo: 0.45 },
  },
  classical: {
    aliases: ['classical', 'orchestra', 'orchestral', 'piano', 'symphony', 'strings', 'baroque'],
    queries: ['classical masterpieces', 'piano classical', 'orchestral'],
    features: { energy: 0.3, valence: 0.5, danceability: 0.15, acousticness: 0.95, tempo: 0.4 },
  },
  reggae: {
    aliases: ['reggae', 'dancehall', 'ska', 'dub', 'roots'],
    queries: ['reggae classics', 'dancehall hits', 'roots reggae'],
    features: { energy: 0.6, valence: 0.8, danceability: 0.8, acousticness: 0.3, tempo: 0.45 },
  },
  latin: {
    aliases: ['latin', 'reggaeton', 'salsa', 'bachata', 'cumbia', 'spanish'],
    queries: ['latin hits', 'reggaeton', 'salsa classics'],
    features: { energy: 0.8, valence: 0.85, danceability: 0.92, acousticness: 0.2, tempo: 0.65 },
  },
  country: {
    aliases: ['country', 'folk', 'americana', 'bluegrass', 'acoustic'],
    queries: ['country hits', 'folk acoustic', 'americana'],
    features: { energy: 0.55, valence: 0.6, danceability: 0.5, acousticness: 0.7, tempo: 0.5 },
  },
  gospel: {
    aliases: ['gospel', 'worship', 'praise', 'christian', 'spiritual', 'hymns'],
    queries: ['gospel worship', 'praise anthems', 'contemporary christian'],
    features: { energy: 0.6, valence: 0.85, danceability: 0.5, acousticness: 0.45, tempo: 0.5 },
  },
  kpop: {
    aliases: ['kpop', 'k-pop', 'korean', 'jpop', 'j-pop'],
    queries: ['k-pop hits', 'kpop dance'],
    features: { energy: 0.85, valence: 0.85, danceability: 0.85, acousticness: 0.12, tempo: 0.7 },
  },
};

const ACTIVITIES = {
  aliases: {
    cooking: ['cooking', 'kitchen', 'dinner'],
    cleaning: ['cleaning', 'chores', 'tidying'],
    shower: ['shower', 'bathroom', 'singing'],
    gaming: ['gaming', 'game', 'stream'],
    yoga: ['yoga', 'stretching', 'pilates'],
  },
};

const DECADES = [
  { re: /\b(19)?50s\b/, from: 1950, to: 1959, q: '50s classics' },
  { re: /\b(19)?60s\b/, from: 1960, to: 1969, q: '60s classics' },
  { re: /\b(19)?70s\b/, from: 1970, to: 1979, q: '70s classics' },
  { re: /\b(19)?80s\b/, from: 1980, to: 1989, q: '80s hits' },
  { re: /\b(19)?90s\b/, from: 1990, to: 1999, q: '90s hits' },
  { re: /\b(20)?00s\b|\b2000s\b/, from: 2000, to: 2009, q: '2000s hits' },
  { re: /\b(20)?10s\b|\b2010s\b/, from: 2010, to: 2019, q: '2010s hits' },
  { re: /\b(20)?20s\b|\b2020s\b/, from: 2020, to: 2029, q: '2020s hits' },
];

module.exports = { MOODS, GENRES, ACTIVITIES, DECADES };
