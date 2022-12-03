DROP TABLE IF EXISTS customers;
CREATE TABLE customers (
  id varchar(255) not null,
  name varchar(255) not null,
  PRIMARY KEY (id)
);

INSERT INTO customers (id, name) VALUES ('1', 'foo');
INSERT INTO customers (id, name) VALUES ('2', 'bar');
INSERT INTO customers (id, name) VALUES ('3', 'baz');