-- The case lists 15 sport names, despite describing 16. Do not invent a missing sport.
INSERT INTO roles (code,name) VALUES
('ADM','Administrator'), ('REG','Registration officer'), ('STO','Store clerk'),
('PAT','Patron'), ('CAP','Captain'), ('FIN','Finance officer'), ('MGT','Management');
INSERT INTO sports(name) VALUES
('Swimming'), ('Hockey'), ('Lawn tennis'), ('Table tennis'), ('Darts'),
('Badminton'), ('Volleyball'), ('Basketball'), ('Netball'), ('Football'),
('Baseball'), ('Rugby'), ('Pool'), ('Chess'), ('Draft');
