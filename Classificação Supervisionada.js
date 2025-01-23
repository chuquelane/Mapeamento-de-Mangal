
// Definir o intervalo de anos para análise
var startYear = '2021-01-01'; // Ano inicial
var endYear = '2021-12-31';   // Ano final

//Importar shape para definir a ROI
var roi = ee.Geometry.Polygon([
  [
    [37.02597172735273, -17.81405861626271], // Coordenadas do primeiro vértice
    [37.32946904180586, -17.81405861626271], // Coordenadas do segundo vértice
    [37.32946904180586, -17.604744688588962], // Coordenadas do terceiro vértice
    [37.02597172735273, -17.604744688588962], // Coordenadas do quarto vértice
    [37.02597172735273, -17.81405861626271]  // Retorno ao ponto inicial para fechar o polígono
  ]
]);
// Importa a coleção de feições de mangais
var mangal = ee.FeatureCollection('users/chuquelane/mangal'); // Carrega o asset de mangais do usuário
// Adiciona os mangais ao mapa, exibindo-os com a cor azul
Map.addLayer(mangal, {color: 'blue'}, 'mangal');

// Importa a coleção de feições de áreas não-mangais
var naomangal = ee.FeatureCollection('users/chuquelane/naomangal'); // Carrega o asset de áreas não-mangais do usuário
// Adiciona as áreas não-mangais ao mapa, também exibindo-as com a cor verde
Map.addLayer(naomangal, {color: 'green'}, 'naomangal');

//Criando o Contorno                                      
var empty = ee.Image().byte(); 
//Contorno da feature
var contorno = empty.paint({
  featureCollection: roi,
  color: 1,
  width: 2
});

//Seleção da coleção
//Aplicando uma máscara de núvens na coleção landsat/
function maskL8sr(image){
    // Bit 0 - Fill
    // Bit 1 - Dilated Cloud
    // Bit 2 - Cirrus
    // Bit 3 - Cloud
    // Bit 4 - Cloud Shadow
    // Bit 5 - Snow
    var qaMask = image.select(['QA_PIXEL']).bitwiseAnd(parseInt('111111', 2)) //analisar
                                          .eq(0) //2 = Unused //eq = 0 condições claras
    var saturationMask = image.select("QA_RADSAT").eq(0) //Radiometric saturation QA
    
    // Aplicar os fatores de escala às bandas apropriadas
    var opticalBands = image.select("SR_B.").multiply(0.0000275).add(-0.2)
    var thermalBands = image.select("ST_B.*").multiply(0.00341802).add(149.0)
    
    // Substitua as faixas originais pelas escalonadas e aplique as máscaras.
    return image
        .addBands(opticalBands, null, true)
        .addBands(thermalBands, null, true)
        .updateMask(qaMask)
        .updateMask(saturationMask)
        .clip(roi)
        .copyProperties(image, image.propertyNames()) //copia a propriedade da coleção
        .set({date: image.date().format('YYYY-MM-dd')}) 
}

// Função para calcular índices de vegetação e água
function indices(image) {
    // Índice de Vegetação Normalizado (NDVI) - Rouse, 1973
    var ndvi = image.normalizedDifference(['SR_B5', 'SR_B4']).rename('NDVI');
    
    // Índice de Vegetação de Mangal (MVI) - Baloloy et al., 2020
    var mvi = image.expression(
        '(NIR - GREEN) / (SWIR - GREEN)', {
          'NIR': image.select('SR_B5'),
          'GREEN': image.select('SR_B3'),
          'SWIR': image.select('SR_B6')
        }).rename('MVI');
    
    // Índice de Diferença Normalizada de Água (NDWI) - McFeeters, 1996
    var ndwi = image.normalizedDifference(['SR_B3', 'SR_B5']).rename('NDWI');
    
    // Adiciona os índices como bandas à imagem
    return image.addBands([ndvi, mvi, ndwi]);
}

//Importando coleção Landsat 8/
var collection = ee.ImageCollection("LANDSAT/LC08/C02/T1_L2")
                            .filterDate(startYear, endYear)
                            .filterBounds(roi)
                            .filter(ee.Filter.lt('CLOUD_COVER',1))
                            .map(maskL8sr)
                            .map(indices)
print('Qtds imgs:',collection.size())


// Coleção reduzida
var collection_reduce = collection.median()
print('Bandas', collection_reduce.bandNames())


// Step 4. Masking before analysis
// Masking for pixel above 50 m
var srtm = ee.Image('USGS/SRTMGL1_003');
var elevation = srtm.select('elevation');
var masksrtm = collection_reduce.lt(50);
var maskedsrtm = collection_reduce.updateMask(masksrtm);

// Water masking
var hansenImage = ee.Image('UMD/hansen/global_forest_change_2015');
var datamask = hansenImage.select('datamask');
var maskland = datamask.eq(1);
var maskedcomposite = maskedsrtm.updateMask(maskland);

// Visualizar a coleação 
Map.addLayer(maskedcomposite, {bands:['SR_B4','SR_B3','SR_B2'],min:0.01, max:0.10}, 'Landsat RGB');
Map.centerObject(roi,10)

var collection_reducee = maskedcomposite.clip(roi);

var collection_reduce_bands =collection_reducee
                            .select(['MVI','NDWI','NDVI','SR_B.*'])
print('Bandas selecionadas',collection_reduce_bands)
//Vai ser utilizada pelo classificador
var bands = collection_reduce_bands.bandNames()

// Carrega a coleção de imagens do ESA WorldCover versão 200
// e seleciona a primeira imagem, já que o conjunto de dados contém apenas uma imagem global.
var dataset = ee.ImageCollection('ESA/WorldCover/v200').first().clip(roi);
var visualization = {
  bands: ['Map'],};
// Filtra a classe de Permanent water bodies (Corpos de água permanentes) no dataset
// A classe de Corpos de água permanentes é representada pelo valor 80 no esquema ESA WorldCover.
var WaterClass = dataset.mask(dataset.eq(80));
// Adiciona ao mapa a camada de Permanent water bodies, mascarando apenas os pixels 
//classificados como 80 (Corpos de água permanentes).
Map.addLayer(dataset.mask(dataset.eq(80)).clip(roi), {}, 'Corpos de água');


// // Criando amostras
// // sampleRegions - Converte cada pixel de uma imagem (em uma determinada escala) que cruza uma
// // ou mais regiões em um recurso, retornando-os como um FeatureCollection.

// print('amostra de agua',amostrasAgua.limit(5))

var amostrasNaomangal = collection_reduce_bands.sampleRegions({
  collection: naomangal,
  scale: 30,
  geometries: true
}).randomColumn('random').limit(1000, 'random', false)

var amostrasMangal = collection_reduce_bands.sampleRegions({
  collection: mangal,
  scale: 30,
  geometries: true
}).randomColumn('random').limit(1000, 'random', false)

//  Juntando as amostras em uma única feature
var labels = amostrasMangal.merge(amostrasNaomangal)
                     
// //Criando uma coluna de valor aleatório 
labels = labels.randomColumn('random',123)
print('Quantas amostras temos?',labels)

// // Ajuste o parâmetro 
var training = labels.filter(ee.Filter.lt('random', 0.7));
var testing = labels.filter(ee.Filter.gte('random', 0.7));

// //Utilizando as amostras para treinar
// var training_samples = collection_reduce_bands.sampleRegions({
//   collection: training,
//   properties: ['classe'],
//   scale: 30,
//   tileScale: 16
// });

// //Aplicar a classificação de acordo com os parâmetros
var classifier = ee.Classifier.smileRandomForest({
numberOfTrees: 500,
//variablesPerSplit: 10,
//bagFraction: 0.7,
//minLeafPopulation: 2,
seed: 123,
}).train(training,'classe',bands)

var classified = collection_reduce_bands.classify(classifier)

// // Exibir as entradas e os resultados.
Map.addLayer(classified, 
            {min: 0, max: 1, palette: ['green', 'yellow']},
            'Classificação RF');


// // // Análise Estatística
var areaImage = ee.Image.pixelArea().divide(1e6).addBands(classified);

// // // Calculo de área por classe
// // // Usando um Redutor Agrupado
var areas = areaImage.reduceRegion({
//Agrupa os registros do redutor pelo valor de uma determinada entrada e reduz 
//cada grupo com o redutor fornecido.
      reducer: ee.Reducer.sum().group({
      groupField: 1, //O campo que contém grupos de registros.
      groupName: 'classification', //A chave do dicionário que contém o grupo. O padrão é 'grupo'.
    }),
    geometry: roi,
    scale: 30,
    bestEffort: true,
    maxPixels: 1e13,
    tileScale:16
    }); 

var classAreas = ee.List(areas.get('groups'))
print('áreas classificadas em km²',classAreas)

// // //Gráfico por classe
var areaChart = ui.Chart.image.byClass({
  image: areaImage,
  classBand: 'classification', 
  region: roi,
  scale: 30,
  reducer: ee.Reducer.sum(),
  classLabels: ['Mangal','Nãomangal'],
}).setOptions({
  hAxis: {title: 'Classes'},
  vAxis: {title: 'Area km²'},
  title: 'Area por classe',
  series: {
    0: { color: 'green'},//mangal
          1: { color: 'yellow'}}// nãomangal
  });
print(areaChart); 


// // //Acurácia 
var acuraciaClassificador = testing.classify(classifier)
/*
Calcula uma matriz de erro 2D para uma coleção comparando duas colunas de uma coleção:
uma contendo os valores reais e outra contendo os valores previstos. 
Espera-se que os valores sejam pequenos inteiros contíguos, 
começando em 0. Eixo 0 (as linhas) 
do matriz correspondem aos valores reais e o Eixo 1 (as colunas) aos valores previstos.
*/
var matrizConfusao = acuraciaClassificador.errorMatrix('classe','classification')

print('Matriz Confusao',matrizConfusao)
print('Acuracia Geral',matrizConfusao.accuracy())
print('Acuracia Consumidor',matrizConfusao.consumersAccuracy())
print('Acuracia Produtor',matrizConfusao.producersAccuracy())
print('Kappa', matrizConfusao.kappa())
///////////////////////////////////////////////////////////////////////////////
//Creation of Classification Legend 
///////////////////////////////////////////////////////////////////////////////

var legend = ui.Panel({
  style: {
    position: 'bottom-right',
    padding: '8px 15px'
  }
});
// Create and add the legend title.
var legendTitle = ui.Label({
  value: 'Cobertura de Mangal  (2021)',
  style: {
    fontWeight: 'bold',
    fontSize: '18px',
    margin: '0 0 4px 0',
    padding: '0'
  }
});
legend.add(legendTitle);

// Creates and styles 1 row of the legend.
var makeRow = function(color, name) {
  // Create the label that is actually the colored box.
  var colorBox = ui.Label({
    style: {
      backgroundColor: '#' + color,
      // Use padding to give the box height and width.
      padding: '8px',
      margin: '0 0 4px 0'
    }
  });

  // Create the label filled with the description text.
  var description = ui.Label({
    value: name,
    style: {margin: '0 0 4px 6px'}
  });

  return ui.Panel({
    widgets: [colorBox, description],
    layout: ui.Panel.Layout.Flow('horizontal')
  });
};

legend.add(makeRow('0064c8', 'Corpo de Água'));//1 
legend.add(makeRow('148140', 'Mangal'));//2
legend.add(makeRow('ffff00', 'Não  Mangal'));//3

Map.add(legend);
