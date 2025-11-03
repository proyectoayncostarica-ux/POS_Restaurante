-- Datos de prueba para la aplicación de gestión de restaurante

-- Insertar productos de ejemplo
INSERT INTO productos (nombre, descripcion, precio, categoria_id, subcategoria_id, es_cocina) VALUES
('Hamburguesa Clásica', 'Hamburguesa con carne, lechuga, tomate y queso', 12.50, 1, 4, 1),
('Pizza Margherita', 'Pizza con salsa de tomate, mozzarella y albahaca', 15.00, 1, 4, 1),
('Ensalada César', 'Ensalada con lechuga, pollo, crutones y aderezo césar', 9.50, 3, NULL, 0),
('Coca Cola', 'Refresco de cola 350ml', 2.50, 2, 7, 0),
('Cerveza Artesanal', 'Cerveza artesanal 330ml', 4.00, 2, 6, 0),
('Papas Fritas', 'Papas fritas crujientes', 5.50, 1, 5, 1),
('Agua Mineral', 'Agua mineral 500ml', 1.50, 2, NULL, 0),
('Pollo a la Parrilla', 'Pechuga de pollo a la parrilla con vegetales', 18.00, 1, 4, 1),
('Sopa del Día', 'Sopa casera del día', 6.00, 3, NULL, 1),
('Café Americano', 'Café americano caliente', 3.00, 2, NULL, 0);

-- Insertar un usuario básico adicional
INSERT INTO usuarios (nombre, password, tipo, fecha_creacion) VALUES
('mesero1', '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', 'basico', datetime('now'));

-- Insertar configuración adicional
INSERT INTO configuracion (clave, valor) VALUES
('impuesto_porcentaje', '10'),
('descuento_maximo', '20'),
('tiempo_sesion_minutos', '480'),
('backup_automatico', 'true'),
('notificaciones_email', 'false');

