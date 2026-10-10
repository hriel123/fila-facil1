# FilaFácil

![Página inicial do FilaFácil](docs/inicio.webp)

**Site:** https://hriel123.github.io/fila-facil1/

Sistema simples de gestão de filas para pequenos negócios: emite senhas, mostra a fila em tempo real e chama o próximo cliente com um clique. Pensado para barbearias, salões, oficinas, lanchonetes, pequenos comércios, recepções, clínicas e eventos.

## Como funciona

1. **Gere a senha:** o cliente recebe uma senha automaticamente.
2. **Acompanhe a fila:** o sistema mostra quantas pessoas estão aguardando.
3. **Chame o próximo:** o atendente chama a próxima senha com um clique.

## Recursos

- Senhas automáticas (A001, A002, ...)
- Fila em tempo real, com quantidade de pessoas aguardando
- Chamar o próximo e finalizar atendimento
- Tempo estimado de espera, a partir do tempo médio por atendimento configurável
- Histórico de atendimentos
- Persistência local: os dados ficam salvos no navegador (`localStorage`) e continuam lá ao recarregar a página

## Demonstração

O site tem uma demonstração funcional na seção "Demonstração do FilaFácil":

![Demonstração da fila em uso](docs/demonstracao.webp)

## Tecnologias

HTML, CSS e JavaScript puros, sem frameworks nem dependências. Hospedado no GitHub Pages.

## Estrutura

```
index.html   página e demonstração
style.css    estilos
script.js    lógica da fila (senhas, chamada, histórico, tempo estimado, localStorage)
*.jpg        imagens dos tipos de negócio
docs/        imagens deste README
```

## Rodar localmente

Basta abrir o `index.html` no navegador, ou servir a pasta:

```bash
python3 -m http.server 8000
```

## Autor

Hariel Silva Fabrício · [Portfólio](https://hriel123.github.io/Portifolio/) · [GitHub](https://github.com/hriel123)
