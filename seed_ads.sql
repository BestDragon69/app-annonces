-- Récupération d'un utilisateur de test (l'administrateur ou le modérateur créé par pool.js)
-- Nous insérons des annonces liées à l'utilisateur 'admin' pour la démonstration
DO $$
DECLARE
    v_user_id UUID;
BEGIN
    SELECT id INTO v_user_id FROM users WHERE email = 'admin@annonces.fr' LIMIT 1;

    IF v_user_id IS NOT NULL THEN
        -- Suppression des anciennes annonces de test pour éviter les doublons
        DELETE FROM ads WHERE user_id = v_user_id;

        -- Insertion d'annonces variées
        -- Catégorie 1 : Véhicules
        INSERT INTO ads (user_id, title, description, price, city, region, status) VALUES
        (v_user_id, 'Peugeot 208 GT Line', 'Vend Peugeot 208 en excellent état. Boîte manuelle, essence, faible kilométrage (45000 km). Contrôle technique OK, révision faite récemment.', 13500.00, 'Lyon', 'Auvergne-Rhône-Alpes', 'active'),
        (v_user_id, 'VTT Rockrider ST 530', 'Vélo tout terrain Rockrider noir et jaune. 9 vitesses, freins à disque hydrauliques. Idéal pour débuter le cross-country. Très peu servi.', 280.00, 'Villeurbanne', 'Auvergne-Rhône-Alpes', 'active');

        -- Catégorie 2 : Immobilier
        INSERT INTO ads (user_id, title, description, price, city, region, status) VALUES
        (v_user_id, 'Studio meublé 25m² - Centre Ville', 'Bel appartement studio entièrement équipé et rénové. Cuisine américaine, lit double escamotable, proche de toutes commodités et du métro. Idéal étudiant.', 650.00, 'Lyon', 'Auvergne-Rhône-Alpes', 'active');

        -- Catégorie 3 : Électronique
        INSERT INTO ads (user_id, title, description, price, city, region, status) VALUES
        (v_user_id, 'iPhone 14 Pro Max 256Go', 'Vends iPhone 14 Pro Max couleur Violet intense. État comme neuf, aucune rayure, toujours protégé par un verre trempé et une coque. Batterie à 92%. Vendu avec boîte et câble.', 890.00, 'Paris', 'Île-de-France', 'active'),
        (v_user_id, 'PC Portable Gaming ASUS ROG', 'Ordinateur puissant pour jeux vidéo et montage. RTX 3070, Intel i7, 16Go RAM, SSD 1To. Écran 144Hz. Parfait état de marche.', 1100.00, 'Marseille', 'Provence-Alpes-Côte d''Azur', 'active'),
        (v_user_id, 'Console PlayStation 5 Standard', 'PS5 édition standard (avec lecteur de disque). Fournie avec deux manettes DualSense et le jeu Spider-Man 2. Facture disponible.', 420.00, 'Bordeaux', 'Nouvelle-Aquitaine', 'active');

        -- Catégorie 4 : Mode
        INSERT INTO ads (user_id, title, description, price, city, region, status) VALUES
        (v_user_id, 'Veste en cuir Vintage', 'Magnifique veste en cuir véritable marron. Style aviateur des années 90. Taille M. Très bon état général, cuir souple et bien entretenu.', 75.00, 'Lille', 'Hauts-de-France', 'active');

        -- Catégorie 5 : Maison & Jardin
        INSERT INTO ads (user_id, title, description, price, city, region, status) VALUES
        (v_user_id, 'Canapé d''angle convertible 3 places', 'Canapé en tissu gris anthracite, convertible en lit d''appoint confortable. Grand coffre de rangement sous la méridienne. À venir récupérer sur place.', 350.00, 'Nantes', 'Pays de la Loire', 'active'),
        (v_user_id, 'Table basse en bois massif', 'Table basse de salon de style industriel, plateau en chêne massif et pieds en métal noir. Dimensions : 110x60cm.', 120.00, 'Toulouse', 'Occitanie', 'active');

        -- Catégorie 8 : Livres & Médias
        INSERT INTO ads (user_id, title, description, price, city, region, status) VALUES
        (v_user_id, 'Collection Manga One Piece Tomes 1 à 50', 'Lot des 50 premiers volumes du manga One Piece. Édition originale en français. Bon état général, idéal pour commencer la collection.', 150.00, 'Strasbourg', 'Grand Est', 'active');

    END IF;
END $$;