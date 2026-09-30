-- MySQL dump 10.13  Distrib 8.0.46, for Linux (x86_64)
--
-- Host: localhost    Database: legacy_synthetic
-- ------------------------------------------------------
-- Server version	8.0.46
-- SYNTHETIC TEST DATA ONLY: every name, address, card and key below is invented.

/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET NAMES utf8mb4 */;
/*!40014 SET @OLD_UNIQUE_CHECKS=@@UNIQUE_CHECKS, UNIQUE_CHECKS=0 */;

--
-- Table structure for table `users`
--

DROP TABLE IF EXISTS `users`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `users` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `name` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `first_name` varchar(191) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `last_name` varchar(191) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `bio` text COLLATE utf8mb4_unicode_ci,
  `social_links` text COLLATE utf8mb4_unicode_ci,
  `email` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `password` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `remember_token` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `magic_login_token` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `stripe_id` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `pm_last_four` varchar(4) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `avatar` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `bank_account_number` varchar(512) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `bank_name` varchar(512) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `address` varchar(512) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `phone` varchar(512) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `organisation` varchar(256) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `pincode` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `ip_address` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `role_id` int DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `users_email_unique` (`email`)
) ENGINE=InnoDB AUTO_INCREMENT=5 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `users`
--

LOCK TABLES `users` WRITE;
/*!40000 ALTER TABLE `users` DISABLE KEYS */;
INSERT INTO `users` VALUES (1,'Priya Fictional','Priya','Fictional','Loves jazz; says \"hi\" and it\'s fine\nsecond line','{\"linkedin\":\"https://linkedin.example/in/priya-fictional\",\"twitter\":\"@priyafic\"}','Priya.Fictional@Example.org','$2y$10$abcdefghijklmnopqrstuuFakeHashValueForTestsOnly.......','rememberme1234567890','0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef','cus_FAKE00000001','1111','avatars/priya.jpg','000123456789','First Fictional Bank','12 Imaginary Rd, Nowhere','+1 (312) 555-9876','Fictional Events LLC','60601','198.51.100.7',3,'2024-05-01 10:00:00'),(2,'Omar O\'Madeup','Omar','O\'Madeup',NULL,NULL,'omar@example.net','$2y$10$zyxwvutsrqponmlkjihgfeFakeHashValueForTestsOnly.......',NULL,NULL,NULL,NULL,NULL,'','','Flat 3, 45 Pretend St','3125550100',NULL,'10115','2001:db8::77',2,'2024-06-02 11:30:00'),(3,'Zoë 😀 Emoji','Zoë','Emoji','Has a semicolon; and a ),( sequence','[]','zoe@example.com','$2y$10$mnopqrstuvwxyzabcdefghFakeHashValueForTestsOnly.......',NULL,NULL,NULL,NULL,NULL,'','',NULL,NULL,NULL,NULL,NULL,2,NULL),(4,'Backslash \\ Tester','B','T','path C:\\\\temp',NULL,'backslash@example.com','$2y$10$qrstuvwxyzabcdefghijklFakeHashValueForTestsOnly.......',NULL,NULL,NULL,NULL,NULL,'','',NULL,NULL,NULL,NULL,NULL,2,NULL);
/*!40000 ALTER TABLE `users` ENABLE KEYS */;
UNLOCK TABLES;

DROP TABLE IF EXISTS `bookings`;
CREATE TABLE `bookings` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `customer_id` int unsigned NOT NULL,
  `event_id` int unsigned NOT NULL,
  `price` decimal(10,2) NOT NULL DEFAULT '0.00',
  `net_price` decimal(10,2) NOT NULL DEFAULT '0.00',
  `customer_name` varchar(256) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `customer_email` varchar(256) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `currency` varchar(5) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `order_number` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

LOCK TABLES `bookings` WRITE;
INSERT INTO `bookings` VALUES (1,1,10,45.00,40.50,'Priya Fictional','priya.fictional@example.org','USD','ORD-1001','2024-05-02 09:00:00'),(2,2,10,-5.25,-5.25,'Omar O\'Madeup','OMAR@EXAMPLE.NET','USD','ORD-1002','2024-06-03 12:00:00'),(3,3,11,0.00,0.00,'Zoë 😀 Emoji','zoe@example.com','EUR','ORD-1003',NULL);
UNLOCK TABLES;

DROP TABLE IF EXISTS `attendees`;
CREATE TABLE `attendees` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `booking_id` int unsigned DEFAULT NULL,
  `name` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `phone` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `address` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO `attendees` VALUES (1,1,'Priya Fictional','+13125559876','priya.fictional@example.org'),(2,1,'Guest Of Priya',NULL,'99 Make Believe Ave');

DROP TABLE IF EXISTS `transactions`;
CREATE TABLE `transactions` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `amount_paid` decimal(10,2) NOT NULL,
  `txn_id` varchar(512) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `payer_reference` varchar(512) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `payment_gateway` varchar(128) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO `transactions` VALUES (1,45.00,'pi_FAKE3Nabcdefghijklmnop','priya.fictional@example.org','stripe'),(2,20.00,'PAYID-FAKE-123456','PAYERFAKE123','paypal');

DROP TABLE IF EXISTS `failed_bookings`;
CREATE TABLE `failed_bookings` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `orderId` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `booking` mediumtext COLLATE utf8mb4_unicode_ci NOT NULL,
  `payment_method` mediumtext COLLATE utf8mb4_unicode_ci NOT NULL,
  `selected_attendees` mediumtext COLLATE utf8mb4_unicode_ci,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO `failed_bookings` VALUES (1,'ORD-FAIL-1','{\"customer_name\":\"Priya Fictional\",\"customer_email\":\"priya.fictional@example.org\",\"quantity\":2}','{\"customer_email\":\"priya.fictional@example.org\",\"cardNumber\":\"4000056655665556\",\"cardMonth\":\"12\",\"cardYear\":\"2030\",\"cvc\":\"987\",\"cardName\":\"PRIYA FICTIONAL\"}','[{\"name\":\"Guest Of Priya\",\"phone\":\"3125550111\",\"address\":\"guest.of.priya@example.org\"}]');

DROP TABLE IF EXISTS `events`;
CREATE TABLE `events` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `title` varchar(256) COLLATE utf8mb4_unicode_ci NOT NULL,
  `description` text COLLATE utf8mb4_unicode_ci,
  `private_info` json DEFAULT NULL,
  `event_password` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `start_date` date DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO `events` VALUES (10,'Summer Gala','Questions? Write to host@example.org or call us.','{\"wifi\": {\"network\": \"GalaGuest\", \"password\": \"sunflower42\"}, \"parking\": {\"code\": \"4821\", \"location\": \"Level B2\"}, \"contact\": {\"name\": \"Dana Planner\", \"email\": \"dana.planner@example.org\", \"phone\": \"+1 312 555 0142\"}}','letmein','2025-07-04'),(11,'Winter Ball',NULL,NULL,NULL,'2025-12-20');

DROP TABLE IF EXISTS `sessions`;
CREATE TABLE `sessions` (
  `id` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `user_id` bigint unsigned DEFAULT NULL,
  `payload` longtext COLLATE utf8mb4_unicode_ci NOT NULL,
  `last_activity` int NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO `sessions` VALUES ('sessFAKEabc123',1,'YTo0OntzOjY6Il90b2tlbiI7czo0MDoiRkFLRSI7fQ==',1714550000);

DROP TABLE IF EXISTS `notifications`;
CREATE TABLE `notifications` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `data` text COLLATE utf8mb4_unicode_ci NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO `notifications` VALUES ('0b9f5a1e-1111-4a4a-8a8a-000000000001','{\"notification\":{\"mail_subject\":\"Your tickets\",\"user\":{\"name\":\"Omar O\'Madeup\",\"email\":\"omar@example.net\"},\"guest_password\":\"Gp4ss-Fake-Word\"}}');

DROP TABLE IF EXISTS `settings`;
CREATE TABLE `settings` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `key` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `display_name` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `value` text COLLATE utf8mb4_unicode_ci,
  PRIMARY KEY (`id`),
  UNIQUE KEY `settings_key_unique` (`key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO `settings` VALUES (1,'site.title','Site Title','Yayatoh Synthetic'),(2,'apps.stripe_secret_key','Stripe Secret','sk_test_fake'),(3,'apps.stripe_public_key','Stripe Public','pk_test_fake'),(4,'mail.mail_username','Mail Username','mailer-user-fake'),(5,'contact.email','Contact Email','hello@example.org'),(6,'contact.phone','Contact Phone','+1 312 555 0199'),(7,'apps.authorize_login_id','Authorize Login','FAKELOGINID'),(8,'storage.aws_access_key_id','AWS Key','fake-access-key-id');

DROP TABLE IF EXISTS `personal_access_tokens`;
CREATE TABLE `personal_access_tokens` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `tokenable_id` bigint unsigned NOT NULL,
  `token` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL,
  `secret_blob` blob,
  PRIMARY KEY (`id`),
  UNIQUE KEY `personal_access_tokens_token_unique` (`token`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO `personal_access_tokens` VALUES (1,1,'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1',0xDEADBEEF),(2,2,'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa2',_binary 'raw\0bytes');
/*!40014 SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS */;

-- Dump completed on 2026-09-28 12:00:00
