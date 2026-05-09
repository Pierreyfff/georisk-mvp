INSERT INTO accidentes (fecha, hora, distrito, ubigeo, tipo, gravedad, ubicacion)
VALUES
('2026-04-20', '18:42:00', 'Cercado de Lima', '150101', 'Choque',    'Alta',  ST_GeogFromText('POINT(-77.042793 -12.046374)')),
('2026-04-21', '07:15:00', 'Miraflores',      '150122', 'Atropello', 'Media', ST_GeogFromText('POINT(-77.030112 -12.103493)')),
('2026-04-21', '22:10:00', 'San Isidro',      '150131', 'Choque',    'Baja',  ST_GeogFromText('POINT(-77.036902 -12.097246)')),
('2026-04-22', '13:05:00', 'Santiago de Surco','150140','Volcadura', 'Alta',  ST_GeogFromText('POINT(-76.998900 -12.139200)')),
('2026-04-23', '09:30:00', 'La Victoria',     '150115', 'Choque',    'Media', ST_GeogFromText('POINT(-77.022500 -12.067300)'));